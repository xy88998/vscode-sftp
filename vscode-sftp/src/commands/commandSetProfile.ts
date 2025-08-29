import * as vscode from 'vscode';
import { COMMAND_SET_PROFILE } from '../constants';
import app from '../app';
import logger from '../logger';
import { getAllFileService } from '../modules/serviceManager';
import { checkCommand } from './abstract/createCommand';

export default checkCommand({
  id: COMMAND_SET_PROFILE,

  async handleCommand(definedProfile) {
    const allServices = getAllFileService();
    const profiles = allServices.reduce<
      Array<vscode.QuickPickItem & { value: string | null; service?: any }>
    >(
      (acc, service) => {
        if (service.getAvailableProfiles().length <= 0) {
          return acc;
        }

        service.getAvailableProfiles().forEach(profile => {
          const isActive = app.state.profile === profile;
          const config = service.getConfig(profile);
          acc.push({
            value: profile,
            label: isActive ? `$(check) ${profile}` : `$(circle-outline) ${profile}`,
            detail: isActive ? '(Current Active Profile)' : undefined,
            description: `${config.host || 'localhost'}:${config.port || 22} → ${config.remotePath}`,
            service: service,
          });
        });
        return acc;
      },
      [
        {
          value: null,
          label: '$(circle-slash) UNSET',
          detail: 'Clear current profile selection',
          description: 'No active SFTP profile'
        },
      ]
    );

    // 如果没有可用的配置文件
    if (profiles.length <= 1) {
      const action = await vscode.window.showInformationMessage(
        'No Available Profile found.',
        'Create Config'
      );
      if (action === 'Create Config') {
        vscode.commands.executeCommand('sftp.config');
      }
      return;
    }

    // 支持命令行参数直接设置配置
    if (definedProfile !== undefined) {
      const index = profiles.findIndex(a => a.value === definedProfile);
      if (index !== -1) {
        app.state.profile = definedProfile;
        vscode.window.showInformationMessage(`Switched to profile: ${definedProfile}`);
      } else {
        app.state.profile = null;
        logger.warn(`try to set a unknown profile "${definedProfile}"`);
        vscode.window.showWarningMessage(`Unknown profile: ${definedProfile}`);
      }
      return;
    }

    // 显示增强的配置选择器
    const item = await vscode.window.showQuickPick(profiles, {
      placeHolder: 'Select SFTP Profile to switch to',
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (item === undefined) return;

    const previousProfile = app.state.profile;
    app.state.profile = item.value;

    // 显示切换结果
    if (item.value === null) {
      vscode.window.showInformationMessage('SFTP profile has been unset');
    } else {
      const message = previousProfile
        ? `Switched from "${previousProfile}" to "${item.value}"`
        : `Activated profile: ${item.value}`;
      vscode.window.showInformationMessage(message);
    }
  },
});
