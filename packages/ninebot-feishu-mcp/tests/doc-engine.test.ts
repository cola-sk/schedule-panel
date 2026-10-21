import assert from "node:assert/strict";
import test from "node:test";
import { parseDocumentTarget } from "../src/feishu-doc-engine";

test("parseDocumentTarget parses /file/ URLs and box tokens", () => {
  const fileUrl = "https://segway-ninebot.feishu.cn/file/boxcn123456789";
  const parsedUrl = parseDocumentTarget(fileUrl);
  assert.equal(parsedUrl.type, "file");
  assert.equal(parsedUrl.documentId, "boxcn123456789");

  const boxToken = "boxcn987654321";
  const parsedToken = parseDocumentTarget(boxToken);
  assert.equal(parsedToken.type, "file");
  assert.equal(parsedToken.documentId, "boxcn987654321");

  const wikiUrl = "https://segway-ninebot.feishu.cn/wiki/T3IXwtjDvinzvNkqZWWcELQnnff";
  const parsedWiki = parseDocumentTarget(wikiUrl);
  assert.equal(parsedWiki.type, "wiki");
  assert.equal(parsedWiki.wikiToken, "T3IXwtjDvinzvNkqZWWcELQnnff");
});
