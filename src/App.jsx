import { useEffect, useMemo, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const DEFAULT_INPUT = `# Example Song - Example Artist
/* Intro */
Opening instrumental
//

//
/* Verse 1 */
Line one of the verse / line two of the verse
Line three of the verse
//
<!-- Chorus -->
Chorus line one / chorus line two / chorus line three
//
# Second Song - Another Artist
/* Bridge */
Bridge line one / bridge line two`;

const LLM_PREP_PROMPT = `Convert the song lyrics below into Worship Deck Generator format.

Output rules:
1) Start each song section with metadata using this format:
# Song Title - Artist
2) Use a single slash (/) for line breaks inside the same slide.
3) Use a double slash (//) to start a new slide.
4) Keep each slide readable (normally 2-3 lines per slide).
5) If a lyrical repetition needs to stay together, allow up to 4 lines on that slide maximum.
6) If there should be a musical interlude, put an empty slide using only // with nothing between delimiters.
7) Add section markers as standalone comment lines using C-style comments, for example:
/* Intro */
/* Verse 1 */
/* Chorus */
/* Bridge */
8) Do not accidentally repeat lyrics. Analyze the full song structure first, then output each lyric part once per intended occurrence.
9) Only keep repeated parts when the original song intentionally repeats them in sequence.
10) Do not add any explanation text, only the final formatted result.

Lyrics to format:
[PASTE RAW LYRICS HERE]`;

const FONT_OPTIONS = [
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times New Roman", value: "\"Times New Roman\", serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Trebuchet MS", value: "\"Trebuchet MS\", sans-serif" },
  { label: "Courier New", value: "\"Courier New\", monospace" }
];

const STORAGE_KEYS = {
  lyricsInput: "worshipDeck.lyricsInput",
  lyricsFontSize: "worshipDeck.lyricsFontSize",
  metaFontSize: "worshipDeck.metaFontSize",
  fontFamily: "worshipDeck.fontFamily",
  lyricsLineHeight: "worshipDeck.lyricsLineHeight"
};

const DEFAULT_SETTINGS = {
  lyricsFontSize: 24,
  metaFontSize: 16,
  fontFamily: "Arial, sans-serif",
  lyricsLineHeight: 1.6
};

function parseSlides(rawText) {
  const segments = rawText.split("//");
  let currentMeta = "";

  const isSectionCommentLine = (line) => {
    return /^\/\*.*\*\/$/.test(line) || /^<!--.*-->$/.test(line);
  };

  return segments.map((segment, index) => {
    const lines = segment.split(/\r?\n/);
    const lyricLines = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        currentMeta = trimmed.slice(1).trim();
      } else if (isSectionCommentLine(trimmed)) {
        return;
      } else {
        lyricLines.push(line);
      }
    });

    const lyricText = lyricLines.join("\n").replace(/\s*\/\s*/g, "\n").trim();

    return {
      id: `slide-${index + 1}`,
      lyricText,
      meta: currentMeta,
      isBlank: lyricText.length === 0
    };
  });
}

export default function App() {
  const [input, setInput] = useState(() => localStorage.getItem(STORAGE_KEYS.lyricsInput) || DEFAULT_INPUT);
  const [isExporting, setIsExporting] = useState(false);
  const [copyingSlideId, setCopyingSlideId] = useState(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [guideMessage, setGuideMessage] = useState("");
  const [lyricsFontSize, setLyricsFontSize] = useState(() => {
    const value = Number(localStorage.getItem(STORAGE_KEYS.lyricsFontSize));
    return Number.isFinite(value) && value >= 24 && value <= 120
      ? value
      : DEFAULT_SETTINGS.lyricsFontSize;
  });
  const [metaFontSize, setMetaFontSize] = useState(() => {
    const value = Number(localStorage.getItem(STORAGE_KEYS.metaFontSize));
    return Number.isFinite(value) && value >= 12 && value <= 42 ? value : DEFAULT_SETTINGS.metaFontSize;
  });
  const [fontFamily, setFontFamily] = useState(() => {
    const storedFont = localStorage.getItem(STORAGE_KEYS.fontFamily);
    return FONT_OPTIONS.some((option) => option.value === storedFont) ? storedFont : DEFAULT_SETTINGS.fontFamily;
  });
  const [lyricsLineHeight, setLyricsLineHeight] = useState(() => {
    const value = Number(localStorage.getItem(STORAGE_KEYS.lyricsLineHeight));
    return Number.isFinite(value) && value >= 0.9 && value <= 2
      ? value
      : DEFAULT_SETTINGS.lyricsLineHeight;
  });

  const slides = useMemo(() => parseSlides(input), [input]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.lyricsInput, input);
  }, [input]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.lyricsFontSize, String(lyricsFontSize));
  }, [lyricsFontSize]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.metaFontSize, String(metaFontSize));
  }, [metaFontSize]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.fontFamily, fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.lyricsLineHeight, String(lyricsLineHeight));
  }, [lyricsLineHeight]);

  const captureSlide = (element) => {
    return html2canvas(element, {
      scale: 2,
      backgroundColor: "#000000",
      useCORS: true,
      ignoreElements: (node) => node.dataset?.uiOnly === "true"
    });
  };

  const handleExportPdf = async () => {
    try {
      setIsExporting(true);
      const slideElements = Array.from(document.querySelectorAll(".deck-slide"));

      if (slideElements.length === 0) {
        return;
      }

      const pageWidth = 1600;
      const pageHeight = 900;
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [pageWidth, pageHeight]
      });

      for (let i = 0; i < slideElements.length; i += 1) {
        const canvas = await captureSlide(slideElements[i]);

        const imgData = canvas.toDataURL("image/jpeg", 1.0);

        if (i > 0) {
          pdf.addPage([pageWidth, pageHeight], "landscape");
        }

        pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight);
      }

      pdf.save("worship-deck.pdf");
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopySlideImage = async (slideId) => {
    const slideElement = document.getElementById(slideId);

    if (!slideElement || !navigator.clipboard || !window.ClipboardItem) {
      setCopyMessage("Clipboard image copy is not supported in this browser.");
      return;
    }

    try {
      setCopyingSlideId(slideId);
      const canvas = await captureSlide(slideElement);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

      if (!blob) {
        throw new Error("Could not create image blob.");
      }

      await navigator.clipboard.write([
        new window.ClipboardItem({
          "image/png": blob
        })
      ]);

      setCopyMessage("Slide copied as image. Paste directly into Canva or other tools.");
    } catch {
      setCopyMessage("Copy failed. Try using Chrome or Edge on HTTPS/localhost.");
    } finally {
      setCopyingSlideId(null);
    }
  };

  const handleCopyGuidePrompt = async () => {
    if (!navigator.clipboard) {
      setGuideMessage("Clipboard is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(LLM_PREP_PROMPT);
      setGuideMessage("LLM prompt copied. Paste it into ChatGPT/Claude/Gemini.");
    } catch {
      setGuideMessage("Could not copy prompt. You can still copy from the text box manually.");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 p-4 text-zinc-900 md:p-6">
      <header className="mx-auto mb-4 flex w-full max-w-[1700px] flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Worship Deck Generator</h1>
          <p className="text-sm text-zinc-600">
            Paste lyrics, preview slides live, and export a PDF deck.
          </p>
          {copyMessage && <p className="mt-1 text-xs text-zinc-500">{copyMessage}</p>}
        </div>

        <button
          type="button"
          onClick={handleExportPdf}
          disabled={isExporting}
          className="h-10 rounded-md border border-zinc-900 bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isExporting ? "Exporting..." : "Export to PDF"}
        </button>
      </header>

      <div className="mx-auto mb-4 w-full max-w-[1700px] rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-800">Slide Settings</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">Lyrics Font Size ({lyricsFontSize}px)</span>
            <input
              type="range"
              min="24"
              max="120"
              value={lyricsFontSize}
              onChange={(event) => setLyricsFontSize(Number(event.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">Metadata Font Size ({metaFontSize}px)</span>
            <input
              type="range"
              min="12"
              max="42"
              value={metaFontSize}
              onChange={(event) => setMetaFontSize(Number(event.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">Font Style</span>
            <select
              value={fontFamily}
              onChange={(event) => setFontFamily(event.target.value)}
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 transition focus:border-zinc-500"
            >
              {FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">
              Line Spacing ({lyricsLineHeight.toFixed(2)})
            </span>
            <input
              type="range"
              min="0.9"
              max="2"
              step="0.02"
              value={lyricsLineHeight}
              onChange={(event) => setLyricsLineHeight(Number(event.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200"
            />
          </label>
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-[1700px] gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <label htmlFor="lyrics-input" className="mb-2 block text-sm font-medium text-zinc-800">
            Lyrics Input
          </label>
          <textarea
            id="lyrics-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-[70vh] w-full resize-none rounded-md border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm leading-relaxed text-zinc-800 outline-none transition focus:border-zinc-400"
            placeholder="Type lyrics and symbols here...

Rules:
# Song Info
/ line break
// new slide
/* Verse 1 */ section comment"
          />
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-zinc-800">Slide Preview (16:9)</h2>
          <div className="h-[70vh] space-y-4 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-3">
            {slides.map((slide, index) => (
              <div key={slide.id} className="mx-auto w-full max-w-3xl">
                <div className="mb-1.5 flex items-center justify-between px-0.5">
                  <span className="text-[11px] text-zinc-500">Slide {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => handleCopySlideImage(slide.id)}
                    disabled={copyingSlideId === slide.id}
                    className="h-7 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {copyingSlideId === slide.id ? "Copying..." : "Copy Image"}
                  </button>
                </div>

                <article
                  id={slide.id}
                  className="deck-slide relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm bg-black"
                  style={{
                    fontFamily
                  }}
                >
                  {!slide.isBlank && (
                    <p
                      className="w-[88%] whitespace-pre-line text-center font-bold text-white"
                      style={{ fontSize: `${lyricsFontSize}px`, lineHeight: lyricsLineHeight }}
                    >
                      {slide.lyricText}
                    </p>
                  )}

                  {slide.meta && !slide.isBlank && (
                    <p
                      className="absolute bottom-[5.5%] left-1/2 w-[92%] -translate-x-1/2 text-center font-normal text-white"
                      style={{ fontSize: `${metaFontSize}px` }}
                    >
                      {slide.meta}
                    </p>
                  )}

                  {!slide.isBlank && (
                    <span data-ui-only="true" className="absolute right-2 top-1.5 text-[10px] text-zinc-500">
                      {index + 1}
                    </span>
                  )}
                </article>
              </div>
            ))}
          </div>
        </section>
      </main>

      <section className="mx-auto mt-4 w-full max-w-[1700px] rounded-md border border-zinc-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-800">How Formatting Works (for LLM prep)</h2>
          <button
            type="button"
            onClick={handleCopyGuidePrompt}
            className="h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            Copy LLM Prompt
          </button>
        </div>

        <p className="mb-2 text-xs text-zinc-600">
          Ask an LLM to convert raw lyrics into this app format first, then paste the result in Lyrics Input and fine-tune.
        </p>
        <ul className="mb-2 text-xs text-zinc-600">
          <li># = song metadata shown at bottom of each slide until replaced</li>
          <li>/ = line break inside current slide</li>
          <li>// = new slide</li>
          <li>/* Verse 1 */ or &lt;!-- Bridge --&gt; = section comments (not rendered)</li>
          <li>Nothing between // delimiters = pure black blank slide</li>
        </ul>
        <textarea
          readOnly
          value={LLM_PREP_PROMPT}
          className="h-44 w-full resize-none rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-700"
        />
        {guideMessage && <p className="mt-2 text-xs text-zinc-500">{guideMessage}</p>}
      </section>
    </div>
  );
}
