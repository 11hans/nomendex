import { MarkSpec, NodeSpec } from "prosemirror-model";

/**
 * Wiki link node specification
 * Renders as an inline node that looks like [[Note Name]]
 */
export const wikiLinkNodeSpec: NodeSpec = {
    group: "inline",
    inline: true,
    atom: true, // Can't edit content directly
    attrs: {
        href: { default: "" },
        title: { default: "" },
    },
    toDOM(node) {
        const isTodoLink = (node.attrs.href as string).startsWith("todo:");
        return [
            "a",
            {
                class: isTodoLink ? "wiki-link todo-link" : "wiki-link",
                href: isTodoLink
                    ? `#/todos/${encodeURIComponent((node.attrs.href as string).slice(5))}`
                    : `#/notes/${encodeURIComponent(node.attrs.href)}`,
                "data-wiki-link": node.attrs.href,
                title: node.attrs.title || node.attrs.href,
            },
            node.attrs.title || node.attrs.href,
        ];
    },
    parseDOM: [
        {
            tag: "a.wiki-link",
            getAttrs(dom) {
                const element = dom as HTMLElement;
                return {
                    href: element.getAttribute("data-wiki-link") || "",
                    title: element.textContent || "",
                };
            },
        },
    ],
};

/**
 * Alternative: Wiki link as a mark (wraps text)
 * Use this if you want the link text to be editable
 */
export const wikiLinkMarkSpec: MarkSpec = {
    attrs: {
        href: { default: "" },
    },
    inclusive: false,
    parseDOM: [
        {
            tag: "a.wiki-link",
            getAttrs(dom) {
                const element = dom as HTMLElement;
                return {
                    href: element.getAttribute("data-wiki-link") || "",
                };
            },
        },
    ],
    toDOM(mark) {
        return [
            "a",
            {
                class: "wiki-link",
                href: `#/notes/${encodeURIComponent(mark.attrs.href)}`,
                "data-wiki-link": mark.attrs.href,
            },
            0,
        ];
    },
};
