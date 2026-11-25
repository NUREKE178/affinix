// Two numbers the phone layout needs and CSS cannot know on its own, kept on <html>:
//   --topbar-h  the real height of the sticky top bar (it grows when its buttons wrap on a narrow screen)
//   --app-vh    the height of what is really visible: the visual viewport, which shrinks while the on-screen keyboard is up
//   --app-top   where that visible part starts: iOS Safari does not resize the page for the keyboard, it pans the visual viewport (offsetTop > 0),
//               so with the keyboard up the open chat is pinned to the visible part (shell.css, html[data-kb]) instead of being left behind above it
// An open chat is sized from them (shell.css) so that the page itself never scrolls and the chat's own header can never slide under the top bar.
export function watchLayoutVars(header) {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const setBar = () => { if (header?.isConnected) root.style.setProperty("--topbar-h", `${Math.round(header.getBoundingClientRect().height)}px`); };
  const setVh = () => root.style.setProperty("--app-vh", `${Math.round(vv ? vv.height : window.innerHeight)}px`);
  // data-vpan: the visual viewport is panned (iOS with the keyboard up). Android Chrome resizes the page instead (offsetTop stays 0), and there the chat stays in the page under the top bar.
  const setTop = () => {
    const top = Math.round(vv ? vv.offsetTop : 0);
    root.style.setProperty("--app-top", `${top}px`);
    if (top > 8) root.dataset.vpan = "1"; else delete root.dataset.vpan;
  };
  setBar(); setVh(); setTop();
  const ro = typeof ResizeObserver === "function" && header ? new ResizeObserver(setBar) : null;
  ro?.observe(header);
  const onResize = () => { setBar(); setVh(); };
  window.addEventListener("resize", onResize);
  const onVv = () => { setVh(); setTop(); };
  vv?.addEventListener("resize", onVv);
  vv?.addEventListener("scroll", setTop);
  return () => {
    ro?.disconnect();
    window.removeEventListener("resize", onResize);
    vv?.removeEventListener("resize", onVv);
    vv?.removeEventListener("scroll", setTop);
    root.style.removeProperty("--topbar-h");
    root.style.removeProperty("--app-vh");
    root.style.removeProperty("--app-top");
    delete root.dataset.vpan;
  };
}
