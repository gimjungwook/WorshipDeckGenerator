import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const DEFAULT_INPUT = `# Example Song - Example Artist
/* Intro */
[[Intro]]
Opening instrumental
//

//
/* Verse 1 */
[[Verse 1]]
Line one of the verse / line two of the verse
Line three of the verse
//
<!-- Chorus -->
[[Chorus]]
Chorus line one / chorus line two / chorus line three
//
# Second Song - Another Artist
/* Bridge */
[[Bridge]]
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
8) Also place jump-link markers with double brackets before major sections, for example:
[[Intro]]
[[Verse 1]]
[[Chorus]]
[[Bridge]]
9) Do not accidentally repeat lyrics. Analyze the full song structure first, then output each lyric part once per intended occurrence.
10) Only keep repeated parts when the original song intentionally repeats them in sequence.
11) Never add divider/separator lines such as --- , ___ , === , or similar decorative lines.
12) Return the final formatted result inside a markdown code block with plaintext language tag. Use this exact wrapper:
\`\`\`plaintext
[formatted lyrics here]
\`\`\`
13) Do not add any explanation text outside the code block.

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
  lyricsLineHeight: "worshipDeck.lyricsLineHeight",
  theme: "worshipDeck.theme"
};

const DEFAULT_SETTINGS = {
  lyricsFontSize: 24,
  metaFontSize: 16,
  fontFamily: "Arial, sans-serif",
  lyricsLineHeight: 1.6
};

const PRESENTATION_CHANNEL = "worshipDeck.presentation";
const SLIDE_BASE_WIDTH = 1600;
const SLIDE_BASE_HEIGHT = 900;
const URL_LYRICS_PARAM = "lyrics";

function encodeLyricsForUrl(value) {
  try {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return "";
  }
}

function decodeLyricsFromUrl(encodedValue) {
  try {
    const normalized = encodedValue.replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = (4 - (normalized.length % 4)) % 4;
    const padded = `${normalized}${"=".repeat(paddingLength)}`;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function PresentationSlide({ slide, fontFamily, lyricsFontSize, metaFontSize, lyricsLineHeight, className = "" }) {
  const viewportRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!viewportRef.current) {
      return;
    }

    const updateScale = () => {
      if (!viewportRef.current) {
        return;
      }

      const rect = viewportRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const fitScale = Math.min(rect.width / SLIDE_BASE_WIDTH, rect.height / SLIDE_BASE_HEIGHT);
      setScale(fitScale);
    };

    updateScale();
    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(viewportRef.current);
    window.addEventListener("resize", updateScale);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  return (
    <div ref={viewportRef} className={`relative h-full w-full overflow-hidden bg-black ${className}`}>
      <article
        className="absolute left-1/2 top-1/2 bg-black"
        style={{
          width: `${SLIDE_BASE_WIDTH}px`,
          height: `${SLIDE_BASE_HEIGHT}px`,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          fontFamily
        }}
      >
        {slide?.imageUrl && (
          <img
            src={slide.imageUrl}
            alt="Slide visual"
            crossOrigin="anonymous"
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
        {!slide?.isBlank && !slide?.imageUrl && (
          <p
            className="absolute left-1/2 top-1/2 w-[88%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-line text-center font-bold text-white"
            style={{ fontSize: `${lyricsFontSize}px`, lineHeight: lyricsLineHeight }}
          >
            {slide.lyricText}
          </p>
        )}
        {slide?.meta && !slide.isBlank && (
          <p
            className="absolute bottom-[5.5%] left-1/2 w-[92%] -translate-x-1/2 text-center font-normal text-white"
            style={{ fontSize: `${metaFontSize}px` }}
          >
            {slide.meta}
          </p>
        )}
      </article>
    </div>
  );
}

function parseSlides(rawText) {
  const segments = rawText.split("//");
  let currentMeta = "";

  const isSectionCommentLine = (line) => {
    return /^\/\*.*\*\/$/.test(line) || /^<!--.*-->$/.test(line);
  };

  const isDividerLine = (line) => {
    return /^[-_=]{3,}$/.test(line.replace(/\s/g, ""));
  };

  const parseImageDirective = (line) => {
    const markdownMatch = line.match(/^!\[[^\]]*\]\((.+)\)$/);
    if (markdownMatch) {
      return markdownMatch[1].trim();
    }

    const shortMatch = line.match(/^@image\s+(.+)$/i);
    if (shortMatch) {
      return shortMatch[1].trim();
    }

    return "";
  };

  return segments.map((segment, index) => {
    const lines = segment.split(/\r?\n/);
    const lyricLines = [];
    const linkTargets = [];
    let imageUrl = "";

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        currentMeta = trimmed.slice(1).trim();
      } else if (isSectionCommentLine(trimmed)) {
        return;
      } else if (isDividerLine(trimmed)) {
        return;
      } else {
        const parsedImageUrl = parseImageDirective(trimmed);
        if (parsedImageUrl) {
          imageUrl = parsedImageUrl;
          return;
        }

        const lineLinkMatches = [...line.matchAll(/\[\[([^\]]+)\]\]/g)]
          .map((match) => match[1].trim())
          .filter(Boolean);

        if (lineLinkMatches.length > 0) {
          lineLinkMatches.forEach((label) => {
            if (!linkTargets.includes(label)) {
              linkTargets.push(label);
            }
          });
        }

        lyricLines.push(line.replace(/\[\[[^\]]+\]\]/g, "").trimEnd());
      }
    });

    const lyricText = lyricLines.join("\n").replace(/\s*\/\s*/g, "\n").trim();

    return {
      id: `slide-${index + 1}`,
      lyricText,
      meta: currentMeta,
      linkTargets,
      imageUrl,
      isBlank: lyricText.length === 0 && !imageUrl
    };
  });
}

export default function App() {
  const isAudienceWindow = useMemo(() => {
    return new URLSearchParams(window.location.search).get("audience") === "1";
  }, []);

  const initialInput = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const encodedLyrics = params.get(URL_LYRICS_PARAM);
    if (encodedLyrics) {
      const decodedLyrics = decodeLyricsFromUrl(encodedLyrics);
      if (decodedLyrics !== null) {
        return decodedLyrics;
      }
    }
    return localStorage.getItem(STORAGE_KEYS.lyricsInput) || DEFAULT_INPUT;
  }, []);

  const [input, setInput] = useState(initialInput);
  const [isExporting, setIsExporting] = useState(false);
  const [copyingSlideId, setCopyingSlideId] = useState(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [guideMessage, setGuideMessage] = useState("");
  const [presentationMessage, setPresentationMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [imageInsertTarget, setImageInsertTarget] = useState("end");
  const [uploadedImageSlides, setUploadedImageSlides] = useState([]);
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    return storedTheme === "dark" ? "dark" : "light";
  });
  const [presenterTypographyOpen, setPresenterTypographyOpen] = useState(true);
  const [presenterNavigatorTextSize, setPresenterNavigatorTextSize] = useState(11);
  const [mobileSection, setMobileSection] = useState("lyrics");
  const [presentationMode, setPresentationMode] = useState("none");
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [presenterLeftWidth, setPresenterLeftWidth] = useState(58);
  const [presenterTopHeight, setPresenterTopHeight] = useState(62);
  const audienceWindowRef = useRef(null);
  const lyricsInputRef = useRef(null);
  const imageFileInputRef = useRef(null);
  const pendingUploadTargetRef = useRef("end");
  const presenterLayoutRef = useRef(null);
  const presenterLeftPaneRef = useRef(null);
  const [audienceState, setAudienceState] = useState({
    slides: [],
    currentSlideIndex: 0,
    fontFamily: DEFAULT_SETTINGS.fontFamily,
    lyricsFontSize: DEFAULT_SETTINGS.lyricsFontSize,
    metaFontSize: DEFAULT_SETTINGS.metaFontSize,
    lyricsLineHeight: DEFAULT_SETTINGS.lyricsLineHeight
  });
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

  const parsedSlides = useMemo(() => parseSlides(input), [input]);

  const slides = useMemo(() => {
    const startSlides = uploadedImageSlides.filter((slide) => slide.insertAt === "start");
    const endSlides = uploadedImageSlides.filter((slide) => slide.insertAt === "end");
    return [...startSlides, ...parsedSlides, ...endSlides];
  }, [parsedSlides, uploadedImageSlides]);

  const currentSlide = slides[currentSlideIndex] || slides[0];
  const isDark = theme === "dark";
  const currentSongName = currentSlide?.meta || "Unlabeled Song";
  const presenterThumbColumns = presenterLeftWidth <= 50 ? 2 : 1;

  const linkGroups = useMemo(() => {
    const groups = [];
    const groupByMeta = new Map();

    slides.forEach((slide, index) => {
      if (!slide.linkTargets || slide.linkTargets.length === 0) {
        return;
      }

      const groupName = slide.meta || "Unlabeled Song";
      if (!groupByMeta.has(groupName)) {
        const group = { song: groupName, links: [] };
        groupByMeta.set(groupName, group);
        groups.push(group);
      }

      const group = groupByMeta.get(groupName);
      slide.linkTargets.forEach((label, linkOrder) => {
        group.links.push({
          id: `${groupName}-${index}-${linkOrder}`,
          label,
          slideIndex: index
        });
      });
    });

    return groups.map((group) => ({
      song: group.song,
      links: group.links
    }));
  }, [slides]);

  const activeLinkBySong = useMemo(() => {
    const active = new Map();

    for (let i = 0; i <= currentSlideIndex && i < slides.length; i += 1) {
      const slide = slides[i];
      const songName = slide.meta || "Unlabeled Song";

      slide.linkTargets.forEach((label, linkOrder) => {
        active.set(songName, `${songName}-${i}-${linkOrder}`);
      });
    }

    return active;
  }, [slides, currentSlideIndex]);

  const presenterSectionGroups = useMemo(() => {
    return linkGroups.map((group) => ({
      song: group.song,
      sections: group.links.map((link) => {
        const slide = slides[link.slideIndex];
        const preview = slide?.imageUrl
          ? "(image slide)"
          : slide?.lyricText
            ? slide.lyricText
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .slice(0, 2)
                .join(" / ")
            : "(blank section)";

        return {
          id: link.id,
          label: link.label,
          slideIndex: link.slideIndex,
          preview
        };
      })
    }));
  }, [linkGroups, slides]);

  useEffect(() => {
    if (isAudienceWindow) {
      return;
    }

    localStorage.setItem(STORAGE_KEYS.lyricsInput, input);

    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (input.trim().length > 0) {
        params.set(URL_LYRICS_PARAM, encodeLyricsForUrl(input));
      } else {
        params.delete(URL_LYRICS_PARAM);
      }

      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", nextUrl);
    }, 220);

    return () => window.clearTimeout(timer);
  }, [input, isAudienceWindow]);

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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    if (!isAudienceWindow || typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(PRESENTATION_CHANNEL);

    channel.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "sync" && message.payload) {
        setAudienceState(message.payload);
      }
      if (message?.type === "stop") {
        setAudienceState((prev) => ({
          ...prev,
          slides: [],
          currentSlideIndex: 0
        }));
      }
    };

    channel.postMessage({ type: "audience-ready" });
    return () => channel.close();
  }, [isAudienceWindow]);

  useEffect(() => {
    if (!isAudienceWindow) {
      return;
    }

    const onAudienceKeyDown = async (event) => {
      if (event.key !== " " && event.code !== "Space") {
        return;
      }

      event.preventDefault();

      if (document.fullscreenElement || !document.documentElement.requestFullscreen) {
        return;
      }

      try {
        await document.documentElement.requestFullscreen();
      } catch {
        return;
      }
    };

    window.addEventListener("keydown", onAudienceKeyDown);
    return () => window.removeEventListener("keydown", onAudienceKeyDown);
  }, [isAudienceWindow]);

  useEffect(() => {
    if (isAudienceWindow || presentationMode !== "presenter" || typeof BroadcastChannel === "undefined") {
      return;
    }

    const payload = {
      slides,
      currentSlideIndex,
      fontFamily,
      lyricsFontSize,
      metaFontSize,
      lyricsLineHeight
    };
    const channel = new BroadcastChannel(PRESENTATION_CHANNEL);

    const sync = () => {
      channel.postMessage({ type: "sync", payload });
    };

    channel.onmessage = (event) => {
      if (event.data?.type === "audience-ready") {
        sync();
      }
    };

    sync();
    const timer = window.setInterval(sync, 700);

    return () => {
      window.clearInterval(timer);
      channel.close();
    };
  }, [
    isAudienceWindow,
    presentationMode,
    slides,
    currentSlideIndex,
    fontFamily,
    lyricsFontSize,
    metaFontSize,
    lyricsLineHeight
  ]);

  useEffect(() => {
    if (isAudienceWindow || presentationMode !== "none") {
      return;
    }

    if (audienceWindowRef.current && !audienceWindowRef.current.closed) {
      audienceWindowRef.current.close();
    }
    audienceWindowRef.current = null;

    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(PRESENTATION_CHANNEL);
      channel.postMessage({ type: "stop" });
      channel.close();
    }

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }, [presentationMode, isAudienceWindow]);

  useEffect(() => {
    if (presentationMode === "none") {
      return;
    }

    const onKeyDown = (event) => {
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(event.key)) {
        event.preventDefault();
        setCurrentSlideIndex((prev) => Math.min(prev + 1, slides.length - 1));
      }

      if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        setCurrentSlideIndex((prev) => Math.max(prev - 1, 0));
      }

      if (event.key === "Home") {
        event.preventDefault();
        setCurrentSlideIndex(0);
      }

      if (event.key === "End") {
        event.preventDefault();
        setCurrentSlideIndex(Math.max(slides.length - 1, 0));
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setPresentationMode("none");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presentationMode, slides.length]);

  useEffect(() => {
    if (presentationMode === "none" || slides.length === 0) {
      return;
    }

    if (currentSlideIndex > slides.length - 1) {
      setCurrentSlideIndex(slides.length - 1);
    }
  }, [slides.length, currentSlideIndex, presentationMode]);

  useEffect(() => {
    if (presentationMode === "none") {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [presentationMode]);

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

  const handleStartPresentation = async (mode) => {
    if (slides.length === 0) {
      return;
    }

    setPresentationMessage("");
    setCurrentSlideIndex(0);
    setPresentationMode(mode);

    if (mode === "presenter") {
      const audienceUrl = `${window.location.origin}${window.location.pathname}?audience=1`;
      const audienceWindow = window.open(audienceUrl, "worshipDeckAudience", "width=1400,height=900");

      if (!audienceWindow) {
        setPresentationMode("none");
        setPresentationMessage("Could not open audience tab. Please allow pop-ups and try again.");
      } else {
        audienceWindowRef.current = audienceWindow;
        setPresentationMessage("Presenter mode started. Audience view opened in a second tab.");
      }
      return;
    }

    if (document.fullscreenElement || !document.documentElement.requestFullscreen) {
      return;
    }

    try {
      await document.documentElement.requestFullscreen();
    } catch {
      return;
    }
  };

  const handleStopPresentation = () => {
    setPresentationMode("none");
  };

  const handleInsertLinkMarker = () => {
    const label = newLinkLabel.trim();
    if (!label || !lyricsInputRef.current) {
      return;
    }

    const marker = `[[${label}]]`;
    const textarea = lyricsInputRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = `${input.slice(0, start)}${marker}${input.slice(end)}`;

    setInput(nextValue);
    setNewLinkLabel("");

    window.requestAnimationFrame(() => {
      const cursor = start + marker.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const addExternalImageSlide = (imageUrl, insertAt) => {
    if (!imageUrl) {
      return;
    }

    setUploadedImageSlides((prev) => [
      ...prev,
      {
        id: `uploaded-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lyricText: "",
        meta: "",
        linkTargets: [],
        imageUrl,
        insertAt,
        isBlank: false
      }
    ]);
  };

  const handleInsertImageSlide = () => {
    const imageUrl = newImageUrl.trim();
    if (!imageUrl) {
      return;
    }

    addExternalImageSlide(imageUrl, imageInsertTarget);
    setNewImageUrl("");
  };

  const handleUploadImageFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        return;
      }

      addExternalImageSlide(result, pendingUploadTargetRef.current || imageInsertTarget);
    };

    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleCopyShareUrl = async () => {
    if (!navigator.clipboard) {
      setShareMessage("Clipboard is not available in this browser.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (input.trim().length > 0) {
      params.set(URL_LYRICS_PARAM, encodeLyricsForUrl(input));
    } else {
      params.delete(URL_LYRICS_PARAM);
    }

    params.delete("audience");
    const query = params.toString();
    const shareUrl = `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage("Share URL copied.");
    } catch {
      setShareMessage("Could not copy share URL.");
    }
  };


  const startMainDividerDrag = (event) => {
    if (!presenterLayoutRef.current) {
      return;
    }

    event.preventDefault();
    const rect = presenterLayoutRef.current.getBoundingClientRect();

    const onMove = (moveEvent) => {
      const ratio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setPresenterLeftWidth(Math.min(78, Math.max(32, ratio)));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startLeftDividerDrag = (event) => {
    if (!presenterLeftPaneRef.current) {
      return;
    }

    event.preventDefault();
    const rect = presenterLeftPaneRef.current.getBoundingClientRect();

    const onMove = (moveEvent) => {
      const ratio = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      setPresenterTopHeight(Math.min(82, Math.max(28, ratio)));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (isAudienceWindow) {
    const audienceSlides = audienceState.slides;
    const safeIndex = Math.min(audienceState.currentSlideIndex, Math.max(audienceSlides.length - 1, 0));
    const audienceSlide = audienceSlides[safeIndex];

    return (
      <div className="fixed inset-0 bg-black text-white">
        <div className="flex h-full items-center justify-center p-4">
          <div className="h-full w-full">
            <PresentationSlide
              slide={audienceSlide || { isBlank: true, lyricText: "", meta: "" }}
              fontFamily={audienceState.fontFamily}
              lyricsFontSize={audienceState.lyricsFontSize}
              metaFontSize={audienceState.metaFontSize}
              lyricsLineHeight={audienceState.lyricsLineHeight}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen p-4 pb-20 md:p-6 md:pb-6 ${isDark ? "bg-zinc-950 text-zinc-100" : "bg-zinc-100 text-zinc-900"}`}>
      <header className="mx-auto mb-4 flex w-full max-w-[1700px] flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Worship Deck Generator</h1>
          <p className={`text-sm ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
            Paste lyrics, preview slides live, and export a PDF deck.
          </p>
          {copyMessage && <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>{copyMessage}</p>}
          {presentationMessage && <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>{presentationMessage}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            className={`h-10 rounded-md border px-4 text-sm font-medium transition ${
              isDark
                ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
            }`}
          >
            {isDark ? "Light Theme" : "Dark Theme"}
          </button>
          <button
            type="button"
            onClick={() => handleStartPresentation("fullscreen")}
            className={`h-10 rounded-md border px-5 text-sm font-medium transition ${
              isDark
                ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
            }`}
          >
            Start Fullscreen
          </button>
          <button
            type="button"
            onClick={() => handleStartPresentation("presenter")}
            className={`h-10 rounded-md border px-5 text-sm font-medium transition ${
              isDark
                ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
            }`}
          >
            Start Presenter
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExporting}
            className="h-10 rounded-md border border-zinc-900 bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? "Exporting..." : "Export to PDF"}
          </button>
        </div>
      </header>

      <div className={`mx-auto mb-4 w-full max-w-[1700px] rounded-md border p-4 ${isDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-white"}`}>
        <h2 className={`mb-3 text-sm font-medium ${isDark ? "text-zinc-100" : "text-zinc-800"}`}>Slide Settings</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <label className="block">
            <span className={`mb-1 block text-xs font-medium ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>Lyrics Font Size ({lyricsFontSize}px)</span>
            <input
              type="range"
              min="24"
              max="120"
              value={lyricsFontSize}
              onChange={(event) => setLyricsFontSize(Number(event.target.value))}
              className={`h-2 w-full cursor-pointer appearance-none rounded-full ${isDark ? "bg-zinc-700" : "bg-zinc-200"}`}
            />
          </label>

          <label className="block">
            <span className={`mb-1 block text-xs font-medium ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>Metadata Font Size ({metaFontSize}px)</span>
            <input
              type="range"
              min="12"
              max="42"
              value={metaFontSize}
              onChange={(event) => setMetaFontSize(Number(event.target.value))}
              className={`h-2 w-full cursor-pointer appearance-none rounded-full ${isDark ? "bg-zinc-700" : "bg-zinc-200"}`}
            />
          </label>

          <label className="block">
            <span className={`mb-1 block text-xs font-medium ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>Font Style</span>
            <select
              value={fontFamily}
              onChange={(event) => setFontFamily(event.target.value)}
              className={`h-10 w-full rounded-md border px-3 text-sm outline-none ring-0 transition ${
                isDark
                  ? "border-zinc-700 bg-zinc-950 text-zinc-100 focus:border-zinc-500"
                  : "border-zinc-300 bg-white text-zinc-900 focus:border-zinc-500"
              }`}
            >
              {FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={`mb-1 block text-xs font-medium ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              Line Spacing ({lyricsLineHeight.toFixed(2)})
            </span>
            <input
              type="range"
              min="0.9"
              max="2"
              step="0.02"
              value={lyricsLineHeight}
              onChange={(event) => setLyricsLineHeight(Number(event.target.value))}
              className={`h-2 w-full cursor-pointer appearance-none rounded-full ${isDark ? "bg-zinc-700" : "bg-zinc-200"}`}
            />
          </label>

          <label className="block">
            <span className={`mb-1 block text-xs font-medium ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>Theme</span>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              className={`h-10 w-full rounded-md border px-3 text-sm outline-none ring-0 transition ${
                isDark
                  ? "border-zinc-700 bg-zinc-950 text-zinc-100 focus:border-zinc-500"
                  : "border-zinc-300 bg-white text-zinc-900 focus:border-zinc-500"
              }`}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-[1700px] gap-4 lg:grid-cols-2">
        <section
          className={`rounded-md border p-4 ${isDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-white"} ${
            mobileSection !== "lyrics" ? "hidden md:block" : "block"
          }`}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="lyrics-input" className={`block text-sm font-medium ${isDark ? "text-zinc-100" : "text-zinc-800"}`}>
              Lyrics Input
            </label>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <input
                type="text"
                value={newLinkLabel}
                onChange={(event) => setNewLinkLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleInsertLinkMarker();
                  }
                }}
                placeholder="Link label"
                className={`h-8 w-36 rounded-md border px-2 text-xs outline-none focus:border-zinc-500 ${
                  isDark ? "border-zinc-700 bg-zinc-950 text-zinc-100" : "border-zinc-300 bg-white text-zinc-800"
                }`}
              />
              <button
                type="button"
                onClick={handleInsertLinkMarker}
                className={`h-8 rounded-md border px-2.5 text-xs font-medium transition ${
                  isDark
                    ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Insert [[Link]]
              </button>
              <button
                type="button"
                onClick={handleCopyShareUrl}
                className={`h-8 rounded-md border px-2.5 text-xs font-medium transition ${
                  isDark
                    ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Copy Share URL
              </button>

              <input
                type="url"
                value={newImageUrl}
                onChange={(event) => setNewImageUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleInsertImageSlide();
                  }
                }}
                placeholder="Image URL"
                className={`h-8 w-44 rounded-md border px-2 text-xs outline-none focus:border-zinc-500 ${
                  isDark ? "border-zinc-700 bg-zinc-950 text-zinc-100" : "border-zinc-300 bg-white text-zinc-800"
                }`}
              />
              <select
                value={imageInsertTarget}
                onChange={(event) => setImageInsertTarget(event.target.value)}
                className={`h-8 rounded-md border px-2 text-xs outline-none focus:border-zinc-500 ${
                  isDark ? "border-zinc-700 bg-zinc-950 text-zinc-100" : "border-zinc-300 bg-white text-zinc-800"
                }`}
              >
                <option value="start">At Start</option>
                <option value="end">At End</option>
              </select>
              <button
                type="button"
                onClick={handleInsertImageSlide}
                className={`h-8 rounded-md border px-2.5 text-xs font-medium transition ${
                  isDark
                    ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Insert Image Slide
              </button>
              <button
                type="button"
                onClick={() => {
                  pendingUploadTargetRef.current = imageInsertTarget;
                  imageFileInputRef.current?.click();
                }}
                className={`h-8 rounded-md border px-2.5 text-xs font-medium transition ${
                  isDark
                    ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Upload Image
              </button>
              <input
                ref={imageFileInputRef}
                type="file"
                accept="image/*"
                onChange={handleUploadImageFile}
                className="hidden"
              />
            </div>
          </div>
          {shareMessage && <p className={`mb-2 text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>{shareMessage}</p>}
          {uploadedImageSlides.length > 0 && (
            <p className={`mb-2 text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
              Uploaded image slides: {uploadedImageSlides.length} (managed outside lyrics text)
            </p>
          )}
          <textarea
            ref={lyricsInputRef}
            id="lyrics-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className={`h-[70vh] w-full resize-none rounded-md border p-4 font-mono text-sm leading-relaxed outline-none transition focus:border-zinc-400 ${
              isDark ? "border-zinc-700 bg-zinc-950 text-zinc-100" : "border-zinc-200 bg-zinc-50 text-zinc-800"
            }`}
            placeholder="Type lyrics and symbols here...

Rules:
# Song Info
/ line break
// new slide
/* Verse 1 */ section comment
[[Chorus]] jump link marker
![](https://image-url) image slide"
          />
        </section>

        <section
          className={`rounded-md border p-4 ${isDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-white"} ${
            mobileSection !== "slides" ? "hidden md:block" : "block"
          }`}
        >
          <h2 className={`mb-2 text-sm font-medium ${isDark ? "text-zinc-100" : "text-zinc-800"}`}>Slide Preview (16:9)</h2>
          <div className={`h-[70vh] space-y-4 overflow-y-auto rounded-md border p-3 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-zinc-200 bg-zinc-50"}`}>
            {slides.map((slide, index) => (
              <div key={slide.id} className="mx-auto w-full max-w-3xl">
                <div className="mb-1.5 flex items-center justify-between px-0.5">
                  <span className={`text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>Slide {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => handleCopySlideImage(slide.id)}
                    disabled={copyingSlideId === slide.id}
                    className={`h-7 rounded-md border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isDark
                        ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                    }`}
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
                  {slide.imageUrl && (
                    <img
                      src={slide.imageUrl}
                      alt="Slide visual"
                      crossOrigin="anonymous"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  )}

                  {!slide.isBlank && !slide.imageUrl && (
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

      <section
        className={`mx-auto mt-4 w-full max-w-[1700px] rounded-md border p-4 ${isDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-white"} ${
          mobileSection !== "prompt" ? "hidden md:block" : "block"
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className={`text-sm font-medium ${isDark ? "text-zinc-100" : "text-zinc-800"}`}>How Formatting Works (for LLM prep)</h2>
          <button
            type="button"
            onClick={handleCopyGuidePrompt}
            className={`h-8 rounded-md border px-3 text-xs font-medium transition ${
              isDark
                ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            Copy LLM Prompt
          </button>
        </div>

        <p className={`mb-2 text-xs ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
          Ask an LLM to convert raw lyrics into this app format first, then paste the result in Lyrics Input and fine-tune.
        </p>
        <ul className={`mb-2 text-xs ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
          <li># = song metadata shown at bottom of each slide until replaced</li>
          <li>/ = line break inside current slide</li>
          <li>// = new slide</li>
          <li>/* Verse 1 */ or &lt;!-- Bridge --&gt; = section comments (not rendered)</li>
          <li>[[Chorus]] = presenter jump link marker (not rendered on slide)</li>
          <li>![](https://image-url) or @image https://image-url = image slide</li>
          <li>Nothing between // delimiters = pure black blank slide</li>
        </ul>
        <textarea
          readOnly
          value={LLM_PREP_PROMPT}
          className={`h-44 w-full resize-none rounded-md border p-3 font-mono text-xs leading-relaxed ${
            isDark ? "border-zinc-700 bg-zinc-950 text-zinc-200" : "border-zinc-200 bg-zinc-50 text-zinc-700"
          }`}
        />
        {guideMessage && <p className={`mt-2 text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>{guideMessage}</p>}
      </section>

      {presentationMode !== "none" && currentSlide && (
        <div className="fixed inset-0 z-50 bg-black text-white">
          {presentationMode === "fullscreen" && (
            <div className="flex h-full items-center justify-center p-4">
              <div className="h-full w-full">
                <PresentationSlide
                  slide={currentSlide}
                  fontFamily={fontFamily}
                  lyricsFontSize={lyricsFontSize}
                  metaFontSize={metaFontSize}
                  lyricsLineHeight={lyricsLineHeight}
                />
              </div>
            </div>
          )}

          {presentationMode === "presenter" && (
            <div ref={presenterLayoutRef} className="flex h-full min-h-0 w-full p-3" style={{ gap: "10px" }}>
              <section ref={presenterLeftPaneRef} className="flex min-h-0 flex-col" style={{ width: `${presenterLeftWidth}%` }}>
                <div className="flex min-h-0 items-center justify-center rounded-md border border-zinc-800 bg-black p-3" style={{ height: `${presenterTopHeight}%` }}>
                  <PresentationSlide
                    slide={currentSlide}
                    fontFamily={fontFamily}
                    lyricsFontSize={lyricsFontSize}
                    metaFontSize={metaFontSize}
                    lyricsLineHeight={lyricsLineHeight}
                  />
                </div>

                <button
                  type="button"
                  onMouseDown={startLeftDividerDrag}
                  className="my-1 h-2 cursor-row-resize rounded bg-zinc-700/80 hover:bg-zinc-500"
                  aria-label="Resize current slide and links panel"
                />

                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2">
                  <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-900 p-2">
                    <button
                      type="button"
                      onClick={() => setPresenterTypographyOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between text-left text-xs text-zinc-300"
                    >
                      <span>Presenter Typography</span>
                      <span className="text-zinc-500">{presenterTypographyOpen ? "Hide" : "Show"}</span>
                    </button>

                    {presenterTypographyOpen && (
                      <div className="mt-2 space-y-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] text-zinc-400">Lyrics Size ({lyricsFontSize}px)</span>
                          <input
                            type="range"
                            min="24"
                            max="120"
                            value={lyricsFontSize}
                            onChange={(event) => setLyricsFontSize(Number(event.target.value))}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-[11px] text-zinc-400">Metadata Size ({metaFontSize}px)</span>
                          <input
                            type="range"
                            min="12"
                            max="42"
                            value={metaFontSize}
                            onChange={(event) => setMetaFontSize(Number(event.target.value))}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-[11px] text-zinc-400">Line Spacing ({lyricsLineHeight.toFixed(2)})</span>
                          <input
                            type="range"
                            min="0.9"
                            max="2"
                            step="0.02"
                            value={lyricsLineHeight}
                            onChange={(event) => setLyricsLineHeight(Number(event.target.value))}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-[11px] text-zinc-400">
                            Navigator Text Size ({presenterNavigatorTextSize}px)
                          </span>
                          <input
                            type="range"
                            min="10"
                            max="18"
                            step="1"
                            value={presenterNavigatorTextSize}
                            onChange={(event) => setPresenterNavigatorTextSize(Number(event.target.value))}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  <p className="mb-2 text-xs text-zinc-400" style={{ fontSize: `${presenterNavigatorTextSize}px` }}>
                    Jump Links (grouped by song)
                  </p>
                  <div className="space-y-3">
                    {linkGroups.map((group) => (
                      <div key={`links-${group.song}`}>
                        <p className="mb-1 text-zinc-500" style={{ fontSize: `${presenterNavigatorTextSize}px` }}>
                          {group.song}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {group.links.length > 0 ? (
                            group.links.map((link) => (
                              <button
                                key={link.id}
                                type="button"
                                onClick={() => setCurrentSlideIndex(link.slideIndex)}
                                className={`rounded-md border px-2 py-1 transition ${
                                  currentSongName === group.song && activeLinkBySong.get(group.song) === link.id
                                    ? "border-zinc-300 bg-zinc-200 text-zinc-900"
                                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                                }`}
                                style={{ fontSize: `${presenterNavigatorTextSize}px` }}
                              >
                                {link.label}
                              </button>
                            ))
                          ) : (
                            <span className="text-zinc-600" style={{ fontSize: `${presenterNavigatorTextSize}px` }}>
                              No link markers
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <button
                type="button"
                onMouseDown={startMainDividerDrag}
                className="h-full w-2 cursor-col-resize rounded bg-zinc-700/80 hover:bg-zinc-500"
                aria-label="Resize presenter columns"
              />

              <aside className="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2">
                <p className="mb-2 text-xs text-zinc-400" style={{ fontSize: `${presenterNavigatorTextSize}px` }}>
                  Section Navigator
                </p>
                <div className="space-y-3">
                  {presenterSectionGroups.map((group) => (
                    <div key={`section-nav-${group.song}`}>
                      <p className="mb-1 text-zinc-500" style={{ fontSize: `${presenterNavigatorTextSize}px` }}>
                        {group.song}
                      </p>
                      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${presenterThumbColumns}, minmax(0, 1fr))` }}>
                        {group.sections.map((section) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => setCurrentSlideIndex(section.slideIndex)}
                            className={`rounded-md border p-2 text-left transition-all duration-150 ${
                              currentSongName === group.song && activeLinkBySong.get(group.song) === section.id
                                ? "border-zinc-300 bg-zinc-200 text-zinc-900 shadow-sm"
                                : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:-translate-y-[1px] hover:border-zinc-500 hover:bg-zinc-800"
                            }`}
                          >
                            <p className="font-semibold" style={{ fontSize: `${presenterNavigatorTextSize}px` }}>
                              {section.label}
                            </p>
                            <p
                              className={`mt-1 leading-snug ${
                                currentSongName === group.song && activeLinkBySong.get(group.song) === section.id
                                  ? "text-zinc-700"
                                  : "text-zinc-400"
                              }`}
                              style={{ fontSize: `${Math.max(presenterNavigatorTextSize - 1, 10)}px` }}
                            >
                              {section.preview}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}
        </div>
      )}

      {presentationMode === "none" && (
        <nav
          className={`fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur md:hidden ${
            isDark ? "border-zinc-800 bg-zinc-900/95" : "border-zinc-200 bg-white/95"
          }`}
        >
          <div className="mx-auto grid max-w-[1700px] grid-cols-3">
            <button
              type="button"
              onClick={() => setMobileSection("lyrics")}
              className={`h-12 text-xs font-medium transition ${
                mobileSection === "lyrics"
                  ? "bg-zinc-900 text-white"
                  : isDark
                    ? "bg-zinc-900 text-zinc-300"
                    : "bg-white text-zinc-700"
              }`}
            >
              Lyrics Input
            </button>
            <button
              type="button"
              onClick={() => setMobileSection("slides")}
              className={`h-12 border-l border-r text-xs font-medium transition ${
                isDark ? "border-zinc-800" : "border-zinc-200"
              } ${
                mobileSection === "slides"
                  ? "bg-zinc-900 text-white"
                  : isDark
                    ? "bg-zinc-900 text-zinc-300"
                    : "bg-white text-zinc-700"
              }`}
            >
              Slides
            </button>
            <button
              type="button"
              onClick={() => setMobileSection("prompt")}
              className={`h-12 text-xs font-medium transition ${
                mobileSection === "prompt"
                  ? "bg-zinc-900 text-white"
                  : isDark
                    ? "bg-zinc-900 text-zinc-300"
                    : "bg-white text-zinc-700"
              }`}
            >
              Prompt
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
