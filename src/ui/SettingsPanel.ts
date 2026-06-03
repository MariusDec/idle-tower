export interface SettingsAPI {
  onClearSave: () => void;
}

export class SettingsPanel {
  private api: SettingsAPI;
  private root: HTMLElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private confirmState = false;

  constructor(api: SettingsAPI) {
    this.api = api;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    parent.className = 'settings-panel';
    this.render();
  }

  unmount(): void {
    this.root = null;
    this.confirmBtn = null;
    this.confirmState = false;
  }

  update(): void {
    // static panel, no updates needed
  }

  private render(): void {
    if (!this.root) return;
    this.root.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Settings';
    this.root.appendChild(title);

    const section = document.createElement('div');
    section.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'settings-section-title';
    sectionTitle.textContent = 'Save Data';
    section.appendChild(sectionTitle);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = 'Clearing your save will delete all progress and reset the game to its initial state. This cannot be undone.';
    section.appendChild(desc);

    this.confirmBtn = document.createElement('button');
    this.confirmBtn.type = 'button';
    this.confirmBtn.className = 'btn-clear-save';
    this.confirmBtn.textContent = 'Clear Save';
    this.confirmBtn.addEventListener('click', () => this.handleClearClick());
    section.appendChild(this.confirmBtn);

    this.root.appendChild(section);
  }

  private handleClearClick(): void {
    if (!this.confirmBtn) return;

    if (!this.confirmState) {
      this.confirmState = true;
      this.confirmBtn.textContent = 'Click again to confirm — this destroys all progress!';
      this.confirmBtn.classList.add('is-confirming');
      setTimeout(() => {
        this.confirmState = false;
        if (this.confirmBtn) {
          this.confirmBtn.textContent = 'Clear Save';
          this.confirmBtn.classList.remove('is-confirming');
        }
      }, 4000);
      return;
    }

    this.confirmState = false;
    this.api.onClearSave();
  }
}
