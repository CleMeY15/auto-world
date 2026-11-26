import wordmark from "./autofindex-wordmark.webp";

export function ProductWordmark() {
  return (
    <a className="site-wordmark" href="/" aria-label="AutoFindex, accueil">
      <img src={wordmark.src} width="180" height="24" alt="AutoFindex" />
    </a>
  );
}
