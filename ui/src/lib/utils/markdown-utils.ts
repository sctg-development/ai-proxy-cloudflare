// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Markdown rendering and processing utilities.
 */
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import highlightJs from 'highlight.js';

export const createMarkedRenderer = () => new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = highlightJs.getLanguage(lang) ? lang : 'plaintext';
      return highlightJs.highlight(code, { language }).value;
    },
  }),
);

export const sanitizeRenderedHtml = (html: string): string => {
  if (typeof window === 'undefined') return html;

  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed, link').forEach((element) => element.remove());
  document.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:') || value.startsWith('vbscript:')) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return document.body.innerHTML;
};

export const renderMarkdown = (content: string, markedRenderer: Marked): string => {
  const rendered = markedRenderer.parse(content);
  return sanitizeRenderedHtml(typeof rendered === 'string' ? rendered : content);
};