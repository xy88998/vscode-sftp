"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
let statusBarItem;
let updateInterval;
let cachedVersion; // 缓存的当前版本
let lastUsedVersion; // 最后一次use的版本
// 比较版本号大小的函数
function compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;
        if (v1Part > v2Part)
            return 1;
        if (v1Part < v2Part)
            return -1;
    }
    return 0;
}
function activate(context) {
    console.log('VS Code NVM extension is now active!');
    // 创建状态栏项
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'nvm.switchVersion';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // 注册切换版本命令
    let switchDisposable = vscode.commands.registerCommand('nvm.switchVersion', async () => {
        await switchNodeVersion();
    });
    context.subscriptions.push(switchDisposable);
    // 跟踪新打开的终端，避免重复执行
    const newTerminals = new Set();
    // 监听新终端打开
    const terminalOpenDisposable = vscode.window.onDidOpenTerminal((terminal) => {
        // 标记为新终端
        newTerminals.add(terminal);
        // 新终端打开时自动设置项目版本或最新版本
        setTimeout(async () => {
            await autoSetNodeVersionForNewTerminal(terminal);
            // 执行完成后从新终端集合中移除
            setTimeout(() => newTerminals.delete(terminal), 2000);
        }, 1000);
    });
    context.subscriptions.push(terminalOpenDisposable);
    // 监听终端变化（当前仅用于清理 newTerminals 集合）
    const terminalChangeDisposable = vscode.window.onDidChangeActiveTerminal((terminal) => {
        // 如果是新打开的终端，从集合中移除（避免内存泄漏）
        if (terminal && newTerminals.has(terminal)) {
            newTerminals.delete(terminal);
        }
    });
    context.subscriptions.push(terminalChangeDisposable);
    // 初始化时显示当前版本
    updateStatusBar();
    // 设置智能定期检查（每15秒）
    updateInterval = setInterval(async () => {
        await checkAndUpdateVersion();
    }, 15000);
}
exports.activate = activate;
function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    if (updateInterval) {
        clearInterval(updateInterval);
    }
}
exports.deactivate = deactivate;
// 自动为新终端设置Node.js版本
async function autoSetNodeVersionForNewTerminal(terminal) {
    try {
        // 1. 检查项目是否有 .nvmrc 文件
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const nvmrcPath = vscode.Uri.joinPath(workspaceFolder.uri, '.nvmrc');
            try {
                const nvmrcContent = await vscode.workspace.fs.readFile(nvmrcPath);
                const projectVersion = Buffer.from(nvmrcContent).toString().trim();
                if (projectVersion) {
                    // 在终端中执行 nvm use 项目版本
                    terminal.sendText(`nvm use ${projectVersion}`);
                    // 更新缓存的版本
                    lastUsedVersion = projectVersion.startsWith('v') ? projectVersion : `v${projectVersion}`;
                    setTimeout(() => updateStatusBar(), 2000);
                    return;
                }
            }
            catch (nvmrcError) {
                // .nvmrc 文件不存在或读取失败，继续下一步
            }
        }
        // 2. 检查 package.json 中的 engines.node 配置
        if (workspaceFolder) {
            const packageJsonPath = vscode.Uri.joinPath(workspaceFolder.uri, 'package.json');
            try {
                const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonPath);
                const packageJson = JSON.parse(Buffer.from(packageJsonContent).toString());
                const nodeVersion = packageJson.engines?.node;
                if (nodeVersion) {
                    // 提取版本号（处理 >=16.0.0 这样的格式）
                    const versionMatch = nodeVersion.match(/(\d+\.\d+\.\d+)/);
                    if (versionMatch) {
                        const version = versionMatch[1];
                        terminal.sendText(`nvm use ${version}`);
                        lastUsedVersion = `v${version}`;
                        setTimeout(() => updateStatusBar(), 2000);
                        return;
                    }
                }
            }
            catch (packageError) {
                // package.json 不存在或解析失败，继续下一步
            }
        }
        // 3. 如果没有项目配置，从已安装版本中获取最新版本
        try {
            const { stdout } = await execAsync('nvm ls');
            const lines = stdout.split('\n');
            let latestVersion = '';
            // 解析已安装的版本，找到最新的版本
            for (const line of lines) {
                const versionMatch = line.match(/v?(\d+\.\d+\.\d+)/);
                if (versionMatch) {
                    const version = versionMatch[1];
                    if (!latestVersion || compareVersions(version, latestVersion) > 0) {
                        latestVersion = version;
                    }
                }
            }
            if (latestVersion) {
                terminal.sendText(`nvm use ${latestVersion}`);
                lastUsedVersion = `v${latestVersion}`;
                setTimeout(() => updateStatusBar(), 2000);
                return;
            }
        }
        catch (listError) {
            // 获取版本列表失败，使用默认行为
        }
        // 4. 如果以上都失败，执行 nvm use node（使用最新已安装版本）
        terminal.sendText('nvm use node');
        setTimeout(() => updateStatusBar(), 2000);
    }
    catch (error) {
        console.error('自动设置Node.js版本失败:', error);
        // 失败时仍然尝试更新状态栏
        setTimeout(() => updateStatusBar(), 2000);
    }
}
async function getCurrentNodeVersion() {
    try {
        // 优先使用 lastUsedVersion（用户最后选择的版本）
        if (lastUsedVersion) {
            return lastUsedVersion;
        }
        return await getCurrentNodeVersionForced();
    }
    catch (error) {
        console.error('获取Node.js版本失败:', error);
        return cachedVersion || 'Unknown';
    }
}
async function getCurrentNodeVersionForced() {
    try {
        // 强制重新检测，不使用 lastUsedVersion 缓存
        // 尝试通过 nvm ls 获取当前激活的版本
        try {
            const { stdout } = await execAsync('nvm ls');
            const lines = stdout.split('\n');
            // 查找带有 * 标记的行（当前激活版本）
            for (const line of lines) {
                if (line.includes('*')) {
                    // 提取版本号，格式通常是 "  * 16.20.2 (Currently using 64-bit executable)"
                    const match = line.match(/\*\s+(\d+\.\d+\.\d+)/);
                    if (match) {
                        const version = match[1];
                        return `v${version}`;
                    }
                }
            }
        }
        catch (nvmError) {
            console.log('nvm ls 失败，尝试其他方法:', nvmError);
        }
        // 回退到系统默认版本
        const { stdout } = await execAsync('node --version');
        const version = stdout.trim();
        return version;
    }
    catch (error) {
        console.error('强制获取Node.js版本失败:', error);
        return cachedVersion || 'Unknown';
    }
}
async function getAvailableVersions() {
    try {
        const { stdout } = await execAsync('nvm ls');
        const lines = stdout.split('\n');
        const versions = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && trimmed.startsWith('v')) {
                // 提取版本号，移除 v 前缀和可能的后缀（如 (linked)）
                const match = trimmed.match(/v([0-9]+\.[0-9]+\.[0-9]+)/);
                if (match) {
                    versions.push(match[1]);
                }
            }
        }
        return versions;
    }
    catch (error) {
        vscode.window.showErrorMessage('无法获取NVM版本列表。请确保已安装nvm-windows。');
        return [];
    }
}
async function switchNodeVersion() {
    try {
        const versions = await getAvailableVersions();
        if (versions.length === 0) {
            vscode.window.showWarningMessage('未找到可用的Node.js版本。');
            return;
        }
        const selectedVersion = await vscode.window.showQuickPick(versions, {
            placeHolder: '选择要切换的Node.js版本'
        });
        if (selectedVersion) {
            // 记录用户选择的版本
            lastUsedVersion = `v${selectedVersion}`;
            // 在VS Code的集成终端中执行nvm use命令
            const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('NVM');
            terminal.show();
            terminal.sendText(`nvm use ${selectedVersion}`);
            vscode.window.showInformationMessage(`已在终端中切换到Node.js版本: ${selectedVersion}`);
            // 立即更新状态栏显示用户选择的版本
            updateStatusBar();
            // 延迟验证版本切换是否成功
            setTimeout(() => {
                updateStatusBar();
            }, 2000);
        }
    }
    catch (error) {
        vscode.window.showErrorMessage(`切换版本失败: ${error}`);
    }
}
async function checkAndUpdateVersion() {
    try {
        // 强制重新检测版本，不使用 lastUsedVersion 缓存
        const newVersion = await getCurrentNodeVersionForced();
        if (newVersion !== cachedVersion) {
            cachedVersion = newVersion;
            updateStatusBar();
        }
    }
    catch (error) {
        console.error('检查版本时出错:', error);
        // 出错时也尝试更新状态栏
        updateStatusBar();
    }
}
async function updateStatusBar() {
    const currentVersion = await getCurrentNodeVersion();
    statusBarItem.text = `Node: ${currentVersion}`;
    statusBarItem.tooltip = `当前Node.js版本: ${currentVersion}\n点击切换版本`;
    // 设置点击命令
    statusBarItem.command = 'nvm.switchVersion';
}
//# sourceMappingURL=extension.js.map