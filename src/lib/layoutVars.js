// Two numbers the phone layout needs and CSS cannot know on its own, kept on <html>:
//   --topbar-h  the real height of the sticky top bar (it grows when its buttons wrap on a narrow screen)
//   --app-vh    the height of what is really visible: the visual viewport, which shrinks while the on-screen keyboard is up
// An open chat is sized from them (shell.css) so that the page itself never scrolls and the chat's own header can never slide under the top bar.
export function watchLayoutVars(header) {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const setBar = () => { if (header?.isConnected) root.style.setProperty("--topbar-h", `${Math.round(header.getBoundingClientRect().height)}px`); };
  const setVh = () => root.style.setProperty("--app-vh", `${Math.round(vv ? vv.height : window.innerHeight)}px`);
  setBar(); setVh();
  const ro = typeof ResizeObserver === "function" && header ? new ResizeObserver(setBar) : null;
  ro?.observe(header);
  const onResize = () => { setBar(); setVh(); };
  window.addEventListener("resize", onResize);
  vv?.addEventListener("resize", setVh);
  return () => {
    ro?.disconnect();
    window.removeEventListener("resize", onResize);
    vv?.removeEventListener("resize", setVh);
    root.style.removeProperty("--topbar-h");
    root.style.removeProperty("--app-vh");
  };
}
