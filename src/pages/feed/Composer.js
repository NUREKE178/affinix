// The "what are you sharing" bar, docked at the bottom of the screen while the feed scrolls under it: text (up to 2000), one picture, a draft that survives leaving the page.
import { html, useState, useRef, useEffect } from "../../lib/preact.js";
import { Card, Button, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { getCurrentUser } from "../../lib/auth.js";
import { createPost } from "../../lib/postsStore.js";
import { uploadPostImage, validateAssetFile } from "../../lib/storage.js";
import { withTimeout } from "../../lib/async.js";
import { moderatePost } from "../../lib/profanityFilter.js";
import { Avatar } from "./parts.js";

export const MAX_LEN = 2000;
const COMPOSER_MIN_H = 42;
const COMPOSER_MAX_H = 240;
const DRAFT_KEY = "decisionos_feed_draft";

function autoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_H), COMPOSER_MAX_H)}px`;
}

const readDraft = () => { try { return localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } };
const writeDraft = (v) => { try { v ? localStorage.setItem(DRAFT_KEY, v) : localStorage.removeItem(DRAFT_KEY); } catch { /* private mode: no draft */ } };

export function Composer({ t, profile, onPosted }) {
  const [draft, setDraft] = useState(readDraft);
  const [posting, setPosting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { autoGrow(taRef.current); }, []);

  // Preview is a local blob: URL for the selected file, revoked whenever it
  // changes or the composer unmounts so we don't leak object URLs.
  useEffect(() => {
    if (!imageFile) { setImagePreview(null); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function onInput(e) {
    const v = e.target.value.slice(0, MAX_LEN);
    setDraft(v);
    writeDraft(v);
    autoGrow(e.target);
  }

  function onPickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    try {
      validateAssetFile(file);
      setImageFile(file);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    }
  }

  async function submit(e) {
    e?.preventDefault?.();
    const rawBody = draft.trim();
    if (!rawBody || posting) return;

    const mod = moderatePost(rawBody);
    if (mod.action === "block") {
      toast(t("feed.profanityBlocked"), "rose");
      return;
    }

    setPosting(true);
    try {
      let imageUrl = null;
      if (imageFile) {
        const authorId = getCurrentUser()?.id;
        const uploaded = await withTimeout(uploadPostImage({ authorId, file: imageFile }), 20000);
        imageUrl = uploaded.url;
      }
      await withTimeout(createPost(mod.text, imageUrl), 15000);
      setDraft("");
      writeDraft("");
      setImageFile(null);
      requestAnimationFrame(() => autoGrow(taRef.current));
      toast(t(mod.action === "censor" ? "feed.postedCensored" : "feed.posted"), mod.action === "censor" ? "amber" : "emerald");
      onPosted?.();
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setPosting(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  }

  // one calm line until the person starts writing; then it opens up (counter, hint, room to grow)
  const open = focused || draft.length > 0 || !!imagePreview || posting;

  return html`
    <div class="feed-dock" data-open=${open} data-testid="feed-composer">
      <form onSubmit=${submit} class="feed-dock-card">
        ${imagePreview && html`
          <div class="feed-dock-preview">
            <img src=${imagePreview} class="sk-display" />
            <button type="button" onClick=${() => setImageFile(null)} aria-label=${t("feed.removeImage")} class="feed-dock-x">
              <${Icon} name="close" size=${12} />
            </button>
          </div>
        `}
        <div class="feed-dock-row">
          <div class="feed-dock-avatar"><${Avatar} name=${profile?.full_name} url=${profile?.avatar_url} /></div>
          <textarea
            ref=${taRef}
            placeholder=${t("feed.composerPlaceholder")}
            value=${draft}
            onInput=${onInput}
            onKeyDown=${onKeyDown}
            onFocus=${() => setFocused(true)}
            onBlur=${() => setFocused(false)}
            rows="1"
            style=${{ height: `${COMPOSER_MIN_H}px` }}
            class="sk-input feed-dock-input"
          ></textarea>
          <button type="button" onClick=${() => fileRef.current?.click()} class="feed-dock-attach" aria-label=${t("feed.addImage")} title=${t("feed.addImage")}>
            <${Icon} name="image" size=${19} />
          </button>
          <input ref=${fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onChange=${onPickImage} />
          <${Button} type="submit" loading=${posting} disabled=${!draft.trim()} className="feed-dock-send">
            ${!posting && html`<${Icon} name="arrowUp" size=${17} strokeWidth=${2.6} />`}<span class="feed-dock-send-label">${posting ? t("feed.posting") : t("feed.publish")}</span>
          <//>
        </div>
        <div class="feed-dock-meta" aria-hidden=${!open}>
          <span class=${draft.length > MAX_LEN - 100 ? "text-amber-400" : ""}>${draft.length}/${MAX_LEN}</span>
          <span>${t("feed.composerHint")}</span>
        </div>
      </form>
    </div>
  `;
}
