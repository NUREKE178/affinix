// The "what are you sharing" box at the bottom of the feed: text (up to 2000), one picture, a draft that survives leaving the page.
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
const COMPOSER_MIN_H = 44;
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

  return html`
    <${Card} className="p-5 mt-6" data-testid="feed-composer">
      <form onSubmit=${submit}>
        <div class="flex gap-3 items-start">
          <div class="pt-1.5"><${Avatar} name=${profile?.full_name} url=${profile?.avatar_url} /></div>
          <div class="flex-1 min-w-0">
            <textarea
              ref=${taRef}
              placeholder=${t("feed.composerPlaceholder")}
              value=${draft}
              onInput=${onInput}
              onKeyDown=${onKeyDown}
              rows="1"
              style=${{ height: `${COMPOSER_MIN_H}px` }}
              class="sk-input w-full rounded-lg px-3.5 py-2.5 text-sm text-graphite-100 placeholder:text-graphite-500 resize-none overflow-hidden leading-relaxed"
            ></textarea>

            ${imagePreview && html`
              <div class="relative inline-block mt-3">
                <img src=${imagePreview} class="sk-display rounded-lg max-h-48 object-cover" />
                <button type="button" onClick=${() => setImageFile(null)}
                  aria-label=${t("feed.removeImage")}
                  class="sk-btn absolute -top-2 -right-2 h-6 w-6 rounded-full text-graphite-300">
                  <${Icon} name="close" size=${12} />
                <//>
              </div>
            `}

            <div class="flex items-center justify-between mt-3">
              <div class="flex items-center gap-3">
                <span class=${`text-xs ${draft.length > MAX_LEN - 100 ? "text-amber-400" : "text-graphite-500"}`}>${draft.length}/${MAX_LEN}</span>
                <button type="button" onClick=${() => fileRef.current?.click()}
                  class="text-graphite-500 hover:text-signal-300 transition-colors" aria-label=${t("feed.addImage")}>
                  <${Icon} name="image" size=${18} />
                <//>
                <input ref=${fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onChange=${onPickImage} />
              </div>
              <${Button} type="submit" loading=${posting} disabled=${!draft.trim()}>
                ${!posting && html`<${Icon} name="plus" size=${16} />`} ${posting ? t("feed.posting") : t("feed.publish")}
              <//>
            </div>
          </div>
        </div>
      </form>
    <//>
  `;
}
