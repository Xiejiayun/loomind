declare module "d3-flextree" {
  export interface FlexHierarchyNode<T> {
    data: T;
    x: number;
    y: number;
    parent: FlexHierarchyNode<T> | null;
    children?: FlexHierarchyNode<T>[];
    each(callback: (node: FlexHierarchyNode<T>) => void): this;
  }

  export interface FlextreeLayout<T> {
    (root: FlexHierarchyNode<T>): FlexHierarchyNode<T>;
    hierarchy(data: T): FlexHierarchyNode<T>;
  }

  export function flextree<T>(options?: {
    nodeSize?: (node: FlexHierarchyNode<T>) => [number, number];
    spacing?: (a: FlexHierarchyNode<T>, b: FlexHierarchyNode<T>) => number;
  }): FlextreeLayout<T>;
}
