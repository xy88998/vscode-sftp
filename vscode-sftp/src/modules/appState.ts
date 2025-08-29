class AppState {
  private _profile: string | null = null;
  private _observer: (x: any) => void;
  private _recentProfiles: string[] = [];
  private _maxRecentProfiles = 5;

  get profile(): string | null {
    return this._profile;
  }

  set profile(newProfile: string | null) {
    if (this._profile === newProfile) {
      return;
    }

    // 记录最近使用的配置
    if (newProfile && this._recentProfiles.includes(newProfile)) {
      // 如果已存在，先移除旧位置
      this._recentProfiles = this._recentProfiles.filter(p => p !== newProfile);
    }
    if (newProfile) {
      // 添加到首位
      this._recentProfiles.unshift(newProfile);
      // 保持最近使用的配置数量
      this._recentProfiles = this._recentProfiles.slice(0, this._maxRecentProfiles);
    }

    this._profile = newProfile;
    this._observer(this.getStateSnapshot());
  }

  getStateSnapshot() {
    return {
      profile: this._profile,
      recentProfiles: [...this._recentProfiles],
    };
  }

  getRecentProfiles(): string[] {
    return [...this._recentProfiles];
  }

  subscribe(observer) {
    this._observer = observer;
  }
}

export default AppState;
