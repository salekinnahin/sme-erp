import { cloneElement, isValidElement, type ReactNode } from "react";

/** Resolve route entry functions and async server components. Client hooks render normally. */
export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(async (child, index) => {
    const resolved = await resolveServerTree(child);
    return isValidElement(resolved) ? cloneElement(resolved, { key: resolved.key ?? `fixture-${index}` }) : resolved;
  }));
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (typeof node.type === "function" && (node.type.constructor.name === "AsyncFunction" || /Page$/.test(node.type.name))) {
    const server = node.type as (props: unknown) => Promise<ReactNode>;
    return resolveServerTree(await server(node.props));
  }
  if (node.props.children !== undefined) return cloneElement(node, { children: await resolveServerTree(node.props.children) });
  return node;
}
