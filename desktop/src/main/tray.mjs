/**
 * The tray icon (menu bar on macOS). Template images on macOS so the icon follows
 * the menu bar's light/dark look; colored icons on Windows and Linux.
 */
import { Menu, Tray, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { trayIcon, trayItems } from "./tray-menu.mjs";

const ASSETS = fileURLToPath(new URL("../../assets/tray/", import.meta.url));

function loadIcon(kind) {
  if (process.platform === "darwin") {
    const img = nativeImage.createFromPath(`${ASSETS}${kind}Template.png`);
    img.setTemplateImage(true);
    return img;
  }
  // Windows picks the @2x file on high-DPI screens; Linux panels get the larger one.
  const file = process.platform === "linux" ? `${ASSETS}${kind}@2x.png` : `${ASSETS}${kind}.png`;
  return nativeImage.createFromPath(file);
}

export class AppTray {
  /**
   * @param {{ model: () => import('./tray-menu.mjs').TrayModel, onClick: (id: string, checked?: boolean) => void }} o
   */
  constructor(o) {
    this.o = o;
    this.icons = {};
    this.lastIcon = null;
    this.tray = new Tray(this.icon("watching"));
    this.tray.setToolTip("Build-a-bot");
    if (process.platform !== "darwin") this.tray.on("click", () => this.tray.popUpContextMenu());
    this.update();
  }

  icon(kind) {
    if (!this.icons[kind]) this.icons[kind] = loadIcon(kind);
    return this.icons[kind];
  }

  update() {
    const m = this.o.model();
    const kind = trayIcon(m);
    if (kind !== this.lastIcon) {
      this.tray.setImage(this.icon(kind));
      this.lastIcon = kind;
    }
    this.tray.setToolTip(`Build-a-bot: ${m.status}`);
    this.tray.setContextMenu(Menu.buildFromTemplate(trayItems(m).map((i) => this.toTemplate(i))));
  }

  toTemplate(item) {
    if (item.type === "separator") return { type: "separator" };
    const t = {
      id: item.id,
      label: item.label,
      type: item.type ?? (item.submenu ? "submenu" : "normal"),
      enabled: item.enabled !== false,
    };
    if (item.type === "checkbox" || item.type === "radio") t.checked = Boolean(item.checked);
    if (item.submenu) t.submenu = item.submenu.map((s) => this.toTemplate(s));
    else if (item.id) t.click = (menuItem) => this.o.onClick(item.id, menuItem?.checked);
    return t;
  }

  destroy() {
    this.tray.destroy();
  }
}
