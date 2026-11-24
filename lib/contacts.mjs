// Both the CLI and the web generator must ground contact details in the supplied résumé.
/** @param {Record<string, unknown>} basics @param {string} [source] */
export function normalizeContacts(basics, source) {
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const tokens = typeof source === "string"
    ? source.split(/[\s<>()\[\]{}"'，。；：、【】]+/u).map((word) => word.replace(/[.,;]+$/, "").replace(/^(?:email|github|linkedin|portfolio|blog|wechat(?: id)?|邮箱|邮件|微信号?|领英|博客|作品集)[:=]/i, ""))
    : null;
  const listed = (value) => !tokens || tokens.includes(value);
  function link(value, network) {
    const input = text(value);
    const raw = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(input) ? "https://" + input : input;
    if (!raw || !/^https?:\/\//i.test(raw)) return undefined;
    try {
      const url = new URL(raw);
      if (url.username || url.password || (network && url.hostname !== network && !url.hostname.endsWith("." + network))) return undefined;
      const bare = raw.replace(/^https?:\/\//i, "").replace(/\/$/, "");
      if (tokens && !tokens.some((token) => token.replace(/^https?:\/\//i, "").replace(/\/$/, "") === bare)) {
        const handle = network === "github.com" && source.match(/\bgithub\s*[:：]?\s+@?([a-z0-9-]+)(?=$|[\s,，;；)])/i)?.[1];
        if (!handle || bare.toLowerCase() !== "github.com/" + handle.toLowerCase()) return undefined;
      }
      return raw;
    } catch {
      return undefined;
    }
  }
  const email = text(basics.email);
  const wechat = text(basics.wechat);
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && listed(email) ? email : "",
    github: link(basics.github, "github.com"),
    linkedin: link(basics.linkedin, "linkedin.com"),
    portfolio: link(basics.portfolio),
    wechat: wechat && listed(wechat) ? wechat : undefined,
  };
}
