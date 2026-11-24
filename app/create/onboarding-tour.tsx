"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { THEMES, type Lang } from "../../lib/schema";
import { prefersReducedMotion } from "../ai-experience";

const steps = [
  { id: "upload", zh: ["导入简历", "上传 PDF 或 Word，也可以粘贴简历，生成中英文交互站。"],
    en: ["Import your résumé", "Upload a PDF or Word document, or paste your résumé to generate a bilingual site."] },
  { id: "preview", zh: ["预览与精修", `在主题选择器切换 ${THEMES.length} 套视觉主题。在预览里点文字直接修改，也可以用 AI 多轮精修。`],
    en: ["Preview and refine", `Choose from ${THEMES.length} visual themes. Click text in the preview to edit it, or refine it with AI.`] },
  { id: "privacy", zh: ["设置隐私和回答边界", "填写期望薪资、到岗时间和回答红线。需要时可隐藏搜索索引，或为简历设置访问口令。"],
    en: ["Set privacy and AI boundaries", "Set salary expectations, availability and topics to decline. Keep your site out of search or add a passcode."] },
  { id: "publish", zh: ["发布与分享", "领取专属 /u/你的名字，导出带二维码的 PDF 或分享海报。招聘方留下的约面线索会出现在访客洞察里。"],
    en: ["Publish and share", "Claim /u/your-name, export a PDF with a QR code or share a poster. Recruiter leads appear in visitor insights."] },
] as const;
type Step = typeof steps[number];
type Tour = { steps: Step[]; index: number };

function targetFor(step: Step) {
  const target = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`);
  return target?.getClientRects().length ? target : null;
}

export function OnboardingTour({ email, lang, blocked }: { email?: string; lang: Lang; blocked: boolean }) {
  const [tour, setTour] = useState<Tour | null>(null);
  const checkedKey = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const storageKey = email ? `talkcv-tour-done:${email}` : null;
  const step = tour?.steps[tour.index];
  const visible = Boolean(step && !blocked);
  const zh = lang === "zh";

  const start = useCallback(() => {
    const available = steps.filter(targetFor);
    if (available.length) setTour({ steps: available, index: 0 });
  }, []);
  const finish = useCallback(() => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, "1"); } catch { /* Keep the dismissal for this visit. */ }
      checkedKey.current = storageKey;
    }
    setTour(null);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || blocked || checkedKey.current === storageKey) return;
    const frame = requestAnimationFrame(() => {
      checkedKey.current = storageKey;
      try { if (localStorage.getItem(storageKey)) return; } catch { /* The tour can still run. */ }
      start();
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey, blocked, start]);

  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el || !visible) return;
    el.showModal();
    return () => el.close();
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible || !step || !card.current || !hole.current) return;
    const panel = card.current;
    const ring = hole.current;
    const target = targetFor(step);
    const ordinal = steps.indexOf(step);
    let frame = 0;
    function measure() {
      frame = 0;
      if (!target?.isConnected || !target.getClientRects().length) {
        const available = steps.filter(targetFor);
        const next = available.find((candidate) => steps.indexOf(candidate) > ordinal);
        if (next) setTour({ steps: available, index: available.indexOf(next) });
        else finish();
        return;
      }
      const rect = target.getBoundingClientRect();
      const w = document.documentElement.clientWidth, h = window.innerHeight;
      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
      const left = clamp(rect.left - 5, 0, w), top = clamp(rect.top - 5, 0, h);
      Object.assign(ring.style, { left: `${left}px`, top: `${top}px`,
        width: `${clamp(rect.right + 5, left, w) - left}px`, height: `${clamp(rect.bottom + 5, top, h) - top}px` });
      const x = clamp(rect.left + (rect.width - panel.offsetWidth) / 2, 12, w - panel.offsetWidth - 12);
      const below = rect.bottom + 16;
      const y = below + panel.offsetHeight <= h - 12 ? below : rect.top - panel.offsetHeight - 16;
      panel.style.setProperty("--tour-x", `${x}px`);
      panel.style.setProperty("--tour-y", `${clamp(y, 12, h - panel.offsetHeight - 12)}px`);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    target?.scrollIntoView({ behavior: prefersReducedMotion() ? "instant" : "smooth", block: "center" });
    schedule();
    const observer = new ResizeObserver(schedule);
    if (target) observer.observe(target);
    observer.observe(panel);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [visible, step, lang, finish]);

  function move(direction: -1 | 1) {
    if (!step) return;
    const available = steps.filter(targetFor);
    const ordinal = steps.indexOf(step);
    const next = direction === 1 ? available.find((s) => steps.indexOf(s) > ordinal) :
      available.filter((s) => steps.indexOf(s) < ordinal).at(-1);
    if (next) setTour({ steps: available, index: available.indexOf(next) });
    else if (direction === 1) finish();
  }

  return <>
    <button type="button" className="af-icon-pill af-guide-button" aria-label="新手引导 / Quick guide"
      title={zh ? "新手引导" : "Quick guide"} onClick={start}>?</button>
    {visible && tour && step && <dialog className="af-tour" ref={dialog} aria-labelledby="tour-title" aria-describedby="tour-description"
      onCancel={(e) => { e.preventDefault(); finish(); }} onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); move(e.key === "ArrowLeft" ? -1 : 1); }
      }}>
      <div ref={hole} className="af-tour-hole" aria-hidden="true" />
      <section className="af-tour-card" ref={card}>
        <div aria-live="polite" aria-atomic="true">
          <small>{zh ? "新手引导" : "Quick guide"} · {tour.index + 1} / {tour.steps.length}</small>
          <h2 id="tour-title">{step[lang][0]}</h2><p id="tour-description">{step[lang][1]}</p>
        </div>
        <div className="af-tour-actions">
          <button type="button" className="af-icon-pill" onClick={finish}>{zh ? "跳过" : "Skip"}</button>
          <button type="button" className="af-icon-pill" disabled={tour.index === 0} onClick={() => move(-1)}>{zh ? "上一步" : "Back"}</button>
          <button type="button" className="af-btn af-btn-primary" onClick={() => move(1)}>
            {tour.index === tour.steps.length - 1 ? (zh ? "完成" : "Finish") : (zh ? "下一步" : "Next")}
          </button>
        </div>
      </section>
    </dialog>}
  </>;
}
