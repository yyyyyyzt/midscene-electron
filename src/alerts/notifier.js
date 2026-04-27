import { Notification, shell } from 'electron';

/**
 * @param {{
 *   title: string;
 *   body: string;
 *   silent?: boolean;
 *   onClick?: () => void;
 * }} opts
 */
export function notify(opts) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: opts.title,
      body: opts.body,
      silent: opts.silent === true,
    });
    if (opts.onClick) n.on('click', opts.onClick);
    n.show();
  } catch {}
}

/** 打开报告（系统默认浏览器 / 文件管理器） */
export function openReport(p) {
  if (!p) return;
  shell.openPath(p).catch(() => {});
}
