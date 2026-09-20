/**
 * Enforces docs/dao-pattern.md: DAOs never export drizzle row types. If you
 * hit this rule, define a DTO interface and convert the drizzle row inside
 * your DAO function.
 *
 * Detection strategy: pragmatic source-text/AST analysis, not full
 * type-checker inference. A type-aware (`@typescript-eslint/utils`
 * services.program) rule would be more precise, but is slow to run per-file
 * and fragile against schema-shape changes (see plan.md Risk Assessment:
 * "ESLint custom rule perf: Type-aware rules are slow"). Instead this rule
 * walks the AST of each exported declaration and flags it when it:
 *
 *   1. References a local symbol that was imported from `drizzle-orm` or any
 *      `drizzle-orm/*` subpath (e.g. re-exporting an imported table object,
 *      or typing a return as that table's row type).
 *   2. Uses the `InferSelectModel` / `InferInsertModel` type utilities
 *      (regardless of where they were imported from).
 *   3. Re-exports a schema table object by name (`export { users }`) when
 *      that name was imported from a local `db/schema` module — the module
 *      that owns drizzle `sqliteTable(...)` definitions in this repo.
 *
 * False negatives are acceptable (e.g. a cleverly renamed/aliased escape
 * hatch). False positives on legitimate DTO interfaces/types are not — the
 * rule only matches identifiers demonstrably tied to a drizzle import, never
 * plain `interface`/`type` shapes authored by hand.
 */

const DRIZZLE_MODULE_PATTERN = /^drizzle-orm(\/.*)?$/;
const SCHEMA_MODULE_PATTERN = /(^|\/)db\/schema(\.ts|\.js)?$/;
const INFER_MODEL_UTILITIES = new Set(["InferSelectModel", "InferInsertModel"]);

/**
 * Depth-first search for any Identifier node whose name is in `names`.
 * @param {object} node
 * @param {Set<string>} names
 * @returns {string | null}
 */
function findMatchingIdentifier(node, names) {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return null;

  if (node.type === "Identifier" && names.has(node.name)) {
    return node.name;
  }

  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const value = node[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findMatchingIdentifier(item, names);
        if (found) return found;
      }
    } else {
      const found = findMatchingIdentifier(value, names);
      if (found) return found;
    }
  }

  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const noDrizzleTypedExports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow exporting drizzle-orm row/table types from apps/api/src/dao/**. DAOs must return DTOs only.",
    },
    schema: [],
    messages: {
      drizzleImportExport:
        "'{{name}}' comes from a drizzle-orm import and is referenced in an exported declaration. DAO exports must be plain DTO interfaces — convert the drizzle row to a DTO with a private `toDto` helper instead.",
      inferModelUtility:
        "Exported type uses '{{name}}', a drizzle-orm type-inference utility. Define an explicit DTO interface instead of deriving the exported type from the table schema.",
      schemaTableReExport:
        "'{{name}}' is a drizzle schema table imported from a schema module and is being re-exported. DAOs must never re-export schema tables — expose DTO-returning functions instead.",
    },
  },

  create(context) {
    /** Local names imported from `drizzle-orm` / `drizzle-orm/*`. */
    const drizzleImportedNames = new Set();
    /** Local names imported from a `db/schema` module (schema tables). */
    const schemaImportedNames = new Set();

    /**
     * Collects the "type surface" nodes of an exported declaration — the
     * parts a caller's type-checker actually sees — while deliberately
     * excluding function/arrow bodies and other runtime-only statements.
     * DAO functions legitimately reference drizzle tables and drizzle-orm
     * helpers (`eq`, `and`, ...) inside their bodies for query building;
     * only the declared signature (param types, return type, variable type
     * annotation) matters for this rule.
     * @param {object} node
     * @returns {object[]}
     */
    function collectTypeSurfaceNodes(node) {
      if (!node || typeof node !== "object") return [];

      switch (node.type) {
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression": {
          const nodes = [];
          for (const param of node.params) nodes.push(param);
          if (node.returnType) nodes.push(node.returnType);
          return nodes;
        }
        case "VariableDeclaration": {
          const nodes = [];
          for (const decl of node.declarations) {
            if (decl.id && decl.id.typeAnnotation) nodes.push(decl.id.typeAnnotation);
            if (decl.init) nodes.push(...collectTypeSurfaceNodes(decl.init));
          }
          return nodes;
        }
        case "TSInterfaceDeclaration":
        case "TSTypeAliasDeclaration":
          // Pure type-space declarations: safe (and necessary) to walk whole.
          return [node];
        case "ClassDeclaration":
        case "ClassExpression":
          return [node.superClass, node.implements].filter(Boolean);
        default:
          // Unknown/other declaration shapes (e.g. plain identifier re-export
          // target): fall back to walking the whole node.
          return [node];
      }
    }

    /**
     * Inspects an exported declaration's type surface for drizzle-tied
     * identifiers and the InferSelectModel/InferInsertModel utilities,
     * reporting at most once per export.
     * @param {object} exportNode
     */
    function checkExport(exportNode) {
      const surfaceNodes = collectTypeSurfaceNodes(exportNode);

      for (const surfaceNode of surfaceNodes) {
        const inferHit = findMatchingIdentifier(surfaceNode, INFER_MODEL_UTILITIES);
        if (inferHit) {
          context.report({ node: exportNode, messageId: "inferModelUtility", data: { name: inferHit } });
          return;
        }
      }

      for (const surfaceNode of surfaceNodes) {
        const schemaHit = findMatchingIdentifier(surfaceNode, schemaImportedNames);
        if (schemaHit) {
          context.report({ node: exportNode, messageId: "schemaTableReExport", data: { name: schemaHit } });
          return;
        }
      }

      for (const surfaceNode of surfaceNodes) {
        const drizzleHit = findMatchingIdentifier(surfaceNode, drizzleImportedNames);
        if (drizzleHit) {
          context.report({ node: exportNode, messageId: "drizzleImportExport", data: { name: drizzleHit } });
          return;
        }
      }
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;

        const isDrizzleModule = DRIZZLE_MODULE_PATTERN.test(source);
        const isSchemaModule = SCHEMA_MODULE_PATTERN.test(source);
        if (!isDrizzleModule && !isSchemaModule) return;

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" ||
            specifier.type === "ImportDefaultSpecifier" ||
            specifier.type === "ImportNamespaceSpecifier"
          ) {
            const localName = specifier.local.name;
            if (isDrizzleModule) drizzleImportedNames.add(localName);
            if (isSchemaModule) schemaImportedNames.add(localName);
          }
        }
      },

      // export { users, users as User } [from "./schema"];
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          // export const/function/interface/type ... — walk the declaration itself.
          checkExport(node.declaration);
          return;
        }

        for (const specifier of node.specifiers) {
          const localName = specifier.local.name;

          if (schemaImportedNames.has(localName)) {
            context.report({ node: specifier, messageId: "schemaTableReExport", data: { name: localName } });
          } else if (drizzleImportedNames.has(localName)) {
            context.report({ node: specifier, messageId: "drizzleImportExport", data: { name: localName } });
          }
        }
      },

      ExportDefaultDeclaration(node) {
        checkExport(node.declaration);
      },
    };
  },
};

export { noDrizzleTypedExports };
