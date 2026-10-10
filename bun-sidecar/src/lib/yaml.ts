import { CORE_SCHEMA, dump, loadAll, mergeTag, timestampTag, YAMLException } from "js-yaml";

export { dump };

/**
 * js-yaml 5 defaults to the plain YAML 1.2 core schema. Keep the js-yaml 4
 * semantics existing notes rely on: unquoted dates load as `Date` and `<<`
 * merge keys resolve. Not YAML11_SCHEMA — that would turn `yes`/`no` into booleans.
 */
const schema = CORE_SCHEMA.withTags(timestampTag, mergeTag);

/**
 * Parse a single YAML document. Unlike js-yaml 5's `load`, empty input (or
 * comments only, e.g. an empty frontmatter block) yields `undefined` instead of throwing.
 */
export function load(text: string): unknown {
    const docs = loadAll(text, { schema });
    if (docs.length > 1) {
        throw new YAMLException("expected a single document in the stream, but found more");
    }
    return docs[0];
}
