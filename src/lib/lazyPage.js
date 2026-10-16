import { html, useState, useEffect } from "./preact.js";
import { LoadingState, Button } from "../components/ui.js";
import { useT } from "./i18n.js";

/** A page that is fetched the first time it is opened instead of with the app: `load` is a dynamic
 * import, `name` the export to render. Pages most people never visit stay out of the first download. */
export function lazyPage(load, name) {
  let mod = null;
  return function LazyPage(props) {
    const t = useT();
    const [, setTick] = useState(0);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (mod) return undefined;
      let off = false;
      setFailed(false);
      load().then((m) => { mod = m; if (!off) setTick((n) => n + 1); }).catch(() => { if (!off) setFailed(true); });
      return () => { off = true; };
    }, [failed === false]);
    if (mod) {
      const Page = mod[name];
      return html`<${Page} ...${props} />`;
    }
    if (failed) {
      return html`<div class="flex flex-col items-center gap-3 py-16"><p class="text-sm text-graphite-400">${t("common.loadOrgErrorBody")}</p><${Button} variant="secondary" onClick=${() => setFailed(false)}>${t("common.retry")}<//></div>`;
    }
    return html`<${LoadingState} label=${t("common.loading")} />`;
  };
}
