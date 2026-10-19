/**
 * Query analysis shared by the local MiniSearch index and its callers.
 * Team vocabulary is supplied at runtime from the authority index; only
 * language-level stop/generic words are kept as defaults here.
 */
const DEFAULT_STOP_WORDS = [
  "请帮我", "帮我", "帮忙", "请问", "麻烦", "一下", "检索", "搜索", "查询", "查找", "查看", "查下", "查一查",
  "找到", "找下", "找一下", "如何", "怎样", "怎么样", "怎么", "哪些", "什么", "是否", "可以", "需要", "应该",
  "配置", "安装", "接入", "使用", "执行", "实施", "落地", "关于", "以及", "并且", "然后", "知识库", "文档",
  "资料", "团队", "我们", "我", "给", "的", "了", "和", "与", "吗", "呢",
];
const DEFAULT_GENERIC_WORDS = [
  "前端", "规范", "标准", "指南", "方案", "说明", "工程化", "工程", "项目", "最佳实践", "手册", "总览", "导航", "索引",
];

export type SearchLexiconEntry = { canonical: string; aliases: string[] };
export type SearchAnalyzerOptions = { lexicon?: SearchLexiconEntry[]; stopWords?: string[]; genericWords?: string[] };
export type SearchQueryAnalysis = {
  normalized: string;
  coreTerms: string[];
  exactPhrases: string[];
  terms: string[];
  isOverviewQuery: boolean;
};
export type SearchAnalyzer = {
  /** Used by the MiniSearch cache to invalidate when the authority lexicon changes. */
  cacheKey: string;
  tokenize(text: string): string[];
  analyzeQuery(query: string): SearchQueryAnalysis;
};

type TrieNode = { children: Map<string, TrieNode>; canonicals?: Set<string>; ascii?: boolean };
type TrieMatch = { start: number; end: number; canonicals: string[] };

const zhSegmenter = new Intl.Segmenter("zh", { granularity: "word" });

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function isAsciiToken(value: string) {
  return /^[a-z0-9@._/-]+$/.test(value);
}

function isAsciiWordCharacter(char: string | undefined) {
  return Boolean(char && /[a-z0-9@._/-]/.test(char));
}

function unique(values: Iterable<string>) {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

const PREFIX_CHARS = new Set([
  "微", "小", "低", "子", "主", "多", "深", "浅", "热", "冷", "预", "懒", "单", "双", "全", "半",
  "非", "无", "未", "反", "自", "跨", "超", "伪", "纯", "零", "云", "端", "强", "弱", "高", "轻",
  "重", "新", "旧", "老", "总", "分", "公", "私", "动", "静", "软", "硬",
]);
const SUFFIX_CHARS = new Set([
  "化", "库", "端", "器", "机", "项", "性", "表", "树", "图", "流", "池", "栈", "队", "链", "包",
  "页", "层", "区", "点", "率", "度", "量", "值", "号", "码", "键", "锁", "源", "方", "架", "件", "屏",
]);

function segmentCjkAtom(atom: string, includeSubStems: boolean): string[] {
  const raw = [...zhSegmenter.segment(atom)]
    .filter((segment) => segment.isWordLike && /[\u4e00-\u9fff]/.test(segment.segment))
    .map((segment) => segment.segment);
  const out = new Set<string>();
  let i = 0;
  while (i < raw.length) {
    if (raw[i].length >= 2) {
      if (
        i + 1 < raw.length &&
        raw[i + 1].length === 1 &&
        SUFFIX_CHARS.has(raw[i + 1]) &&
        (i + 2 >= raw.length || raw[i + 2].length >= 2)
      ) {
        out.add(raw[i] + raw[i + 1]);
        if (includeSubStems) out.add(raw[i]);
        i += 2;
        continue;
      }
      out.add(raw[i]);
      i++;
      continue;
    }

    let j = i;
    while (j < raw.length && raw[j].length === 1) j++;
    const run = raw.slice(i, j);
    const runLen = run.length;
    if (runLen === 1) {
      const ch = run[0];
      if (j < raw.length && (PREFIX_CHARS.has(ch) || i === 0)) {
        out.add(ch + raw[j]);
        if (includeSubStems) out.add(raw[j]);
        i = j + 1;
        continue;
      }
      if (i > 0) {
        out.add(raw[i - 1] + ch);
      }
    } else if (runLen === 2) {
      out.add(run.join(""));
    } else if (runLen === 3) {
      out.add(run.join(""));
      if (includeSubStems) {
        if (SUFFIX_CHARS.has(run[2])) out.add(run[0] + run[1]);
        if (PREFIX_CHARS.has(run[0])) out.add(run[1] + run[2]);
      }
    } else if (runLen % 2 === 1 && PREFIX_CHARS.has(run[0])) {
      out.add(run[0] + run[1] + run[2]);
      if (includeSubStems) out.add(run[1] + run[2]);
      for (let k = 3; k + 1 < runLen; k += 2) out.add(run[k] + run[k + 1]);
    } else if (runLen % 2 === 1 && SUFFIX_CHARS.has(run[runLen - 1])) {
      for (let k = 0; k + 1 < runLen - 3; k += 2) out.add(run[k] + run[k + 1]);
      out.add(run.slice(runLen - 3).join(""));
      if (includeSubStems) out.add(run[runLen - 3] + run[runLen - 2]);
    } else {
      for (let k = 0; k + 1 < runLen; k += 2) out.add(run[k] + run[k + 1]);
      if (runLen % 2 === 1) out.add(run.slice(runLen - 2).join(""));
    }
    i = j;
  }
  return [...out];
}

function segmentCjkPhrase(phrase: string, includeSubStems: boolean): string[] {
  // Prevent ICU's dictionary from splitting "前端子应用" into "前" + "端子" + "应用".
  const parts = phrase.split(/(?=子应用)/);
  const out = new Set<string>();
  for (const part of parts) {
    for (const seg of segmentCjkAtom(part, includeSubStems)) out.add(seg);
  }
  return [...out];
}

function sliceUnmatchedCjkIntervals(phrase: string, phraseStart: number, matches: TrieMatch[]): string[] {
  const phraseEnd = phraseStart + phrase.length;
  const intervals = matches
    .filter((match) => match.start < phraseEnd && match.end > phraseStart)
    .map(
      (match) =>
        [Math.max(match.start, phraseStart) - phraseStart, Math.min(match.end, phraseEnd) - phraseStart] as const,
    )
    .sort((a, b) => a[0] - b[0]);
  if (!intervals.length) return [phrase];
  const slices: string[] = [];
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (start > cursor) slices.push(phrase.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < phrase.length) slices.push(phrase.slice(cursor));
  return slices.filter(Boolean);
}

export function createSearchAnalyzer(options: SearchAnalyzerOptions = {}): SearchAnalyzer {
  const stopWords = unique(options.stopWords || DEFAULT_STOP_WORDS);
  const genericWords = unique(options.genericWords || DEFAULT_GENERIC_WORDS);
  const sortedStopWords = [...stopWords].sort((a, b) => b.length - a.length);
  const trieRoot: TrieNode = { children: new Map() };
  const aliasToCanonicals = new Map<string, Set<string>>();
  const lexicon = options.lexicon || [];

  const addTrieTerm = (term: string, canonical: string) => {
    const normalized = normalizeSearchText(term);
    const canonicalTerm = normalizeSearchText(canonical);
    if (!normalized || !canonicalTerm) return;
    const canonicalSet = aliasToCanonicals.get(normalized) || new Set<string>();
    canonicalSet.add(canonicalTerm);
    aliasToCanonicals.set(normalized, canonicalSet);
    let node = trieRoot;
    for (const char of normalized) {
      let child = node.children.get(char);
      if (!child) {
        child = { children: new Map() };
        node.children.set(char, child);
      }
      node = child;
    }
    node.canonicals ||= new Set<string>();
    node.canonicals.add(canonicalTerm);
    node.ascii = isAsciiToken(normalized);
  };

  for (const entry of lexicon) {
    addTrieTerm(entry.canonical, entry.canonical);
    for (const alias of entry.aliases) addTrieTerm(alias, entry.canonical);
  }

  const isBoundaryValid = (normalized: string, start: number, end: number, isAscii: boolean) =>
    !isAscii || (!isAsciiWordCharacter(normalized[start - 1]) && !isAsciiWordCharacter(normalized[end]));

  const findTrieMatches = (normalized: string, includePrefixMatches = false): TrieMatch[] => {
    const matches: TrieMatch[] = [];
    for (let start = 0; start < normalized.length;) {
      let node = trieRoot;
      let cursor = start;
      let best: TrieMatch | undefined;
      const prefixCanonicals = new Set<string>();
      while (cursor < normalized.length) {
        const child = node.children.get(normalized[cursor]);
        if (!child) break;
        node = child;
        cursor++;
        if (node.canonicals?.size && isBoundaryValid(normalized, start, cursor, Boolean(node.ascii))) {
          if (includePrefixMatches) {
            node.canonicals.forEach((canonical) => prefixCanonicals.add(canonical));
          }
          best = {
            start,
            end: cursor,
            canonicals: includePrefixMatches ? [...prefixCanonicals] : [...node.canonicals],
          };
        }
      }
      if (best) {
        matches.push(best);
        start = best.end;
      } else {
        start++;
      }
    }
    return matches;
  };

  const isGenericTerm = (term: string) => {
    let rest = term;
    for (const word of genericWords) rest = rest.split(word).join("");
    return rest.length === 0;
  };

  const tokenize = (text: string): string[] => {
    const normalized = normalizeSearchText(text);
    if (!normalized) return [];
    const matches = findTrieMatches(normalized, true);
    const terms = new Set(matches.flatMap((match) => match.canonicals));
    for (const match of matches) {
      const surface = normalized.slice(match.start, match.end).trim();
      if (surface.length >= 2) terms.add(surface);
    }
    for (const token of normalized.match(/[a-z0-9@][a-z0-9_.@/-]*/g) || []) {
      const canonicals = aliasToCanonicals.get(token);
      if (canonicals?.size) canonicals.forEach((canonical) => terms.add(canonical));
      terms.add(token);
    }
    for (const run of normalized.matchAll(/[\u4e00-\u9fff]+/g)) {
      const phrase = run[0];
      const start = run.index || 0;
      terms.add(phrase);
      for (const slice of sliceUnmatchedCjkIntervals(phrase, start, matches)) {
        for (const segment of segmentCjkPhrase(slice, true)) terms.add(segment);
      }
      for (const segment of segmentCjkPhrase(phrase, true)) terms.add(segment);
    }
    return unique(terms);
  };

  const analyzeQuery = (query: string): SearchQueryAnalysis => {
    const normalized = normalizeSearchText(query);
    const matches = findTrieMatches(normalized);
    let stripped = normalized;
    for (const word of sortedStopWords) stripped = stripped.split(word).join(" ");
    const strippedMatches = findTrieMatches(stripped);
    const allTrieCanonicals = [...matches, ...strippedMatches].flatMap((match) => match.canonicals);
    const terms = new Set<string>(allTrieCanonicals);
    const coreTerms = new Set<string>(allTrieCanonicals);
    const exactPhrases = new Set<string>();

    for (const token of stripped.match(/[a-z0-9@][a-z0-9_.@/-]*/g) || []) {
      const canonicals = aliasToCanonicals.get(token);
      const resolved = canonicals?.size ? [...canonicals] : [token];
      for (const term of resolved) {
        terms.add(term);
        if (term.length >= 2 && !isGenericTerm(term)) coreTerms.add(term);
      }
    }
    for (const phraseMatch of stripped.matchAll(/[\u4e00-\u9fff]+/g)) {
      const phrase = phraseMatch[0];
      if (phrase.length >= 2) {
        terms.add(phrase);
        if (phrase.length >= 4) exactPhrases.add(phrase);
      }
      const phraseStart = phraseMatch.index || 0;
      const knownTerms = strippedMatches
        .filter((match) => match.start < phraseStart + phrase.length && match.end > phraseStart)
        .flatMap((match) => match.canonicals);
      for (const slice of sliceUnmatchedCjkIntervals(phrase, phraseStart, strippedMatches)) {
        for (const segment of segmentCjkPhrase(slice, false)) {
          if (knownTerms.some((term) => term.includes(segment))) continue;
          terms.add(segment);
          if (!isGenericTerm(segment)) coreTerms.add(segment);
        }
      }
    }
    const normalizedCoreTerms = unique(coreTerms).filter((term) => term.length >= 2 && !isGenericTerm(term));
    return {
      normalized,
      coreTerms: normalizedCoreTerms,
      exactPhrases: unique(exactPhrases),
      terms: unique(terms),
      isOverviewQuery: normalizedCoreTerms.length === 0,
    };
  };

  const cacheKey = JSON.stringify({
    genericWords,
    stopWords,
    lexicon: lexicon.map((entry) => [normalizeSearchText(entry.canonical), [...entry.aliases].map(normalizeSearchText).sort()]),
  });
  return { cacheKey, tokenize, analyzeQuery };
}

const defaultAnalyzer = createSearchAnalyzer();

/** Compatibility helpers for external callers without an authority-index lexicon. */
export function tokenizeSearchText(text: string, analyzer = defaultAnalyzer): string[] {
  return analyzer.tokenize(text);
}

export function analyzeSearchQuery(query: string, analyzer = defaultAnalyzer): SearchQueryAnalysis {
  return analyzer.analyzeQuery(query);
}
