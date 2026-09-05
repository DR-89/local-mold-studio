export type FabricationErrorLike = {
  code?: string;
  message: string;
  detail?: string;
};

export function fabricationErrorHint(error: FabricationErrorLike): string {
  const context = `${error.message} ${error.detail ?? ""}`.toLowerCase();

  if (context.includes("depth-interface") && context.includes("inner")) {
    return "Use 2 parts or Auto to remove unnecessary depth columns, or increase print-bed depth. If the depth split is required, reduce hex connector width or increase wall thickness, then regenerate.";
  }
  if (context.includes("height-interface") && context.includes("inner")) {
    return "Increase print height to use fewer height rows. If the height split is required, reduce hex connector width or increase wall thickness, then regenerate.";
  }
  if (context.includes("cannot be fully anchored")) {
    return "Reduce hex connector width, increase wall thickness, or use fewer mold segments so the connector has a larger continuous wall area.";
  }
  if (
    context.includes("safe distance to the cavity") ||
    context.includes("wider than the safe outer wall")
  ) {
    return "Reduce All hex connector width across flats (try 2.0 mm) or increase Wall thickness. Keep Fit clearance near 0.20 mm unless your printer requires more.";
  }
  if (error.code === "PRINT_VOLUME_EXCEEDED") {
    return "Enable height splitting or Auto pieces, or increase the configured print-bed width, depth, or height to match the printer.";
  }
  if (error.code === "SEAM_OUTSIDE_MODEL") {
    return "Move Seam position back inside the model or use Auto orient, then regenerate.";
  }
  if (context.includes("gate") || context.includes("pour channel")) {
    return "Move or redistribute the affected pour hole, reduce its diameter, or reduce the hex connector width to create a clear registration position.";
  }
  if (error.code === "INVALID_SOURCE_MESH" || error.code === "TOPOLOGY_INVALID") {
    return "Repair the source as a closed manifold mesh, remove overlapping shells, and import the repaired STL, OBJ, or 3MF again.";
  }
  if (error.code === "MEMORY_BUDGET_EXCEEDED") {
    return "Reduce the model triangle count or scale, close other large browser tasks, and retry locally.";
  }
  if (error.code === "FEATURE_COLLISION") {
    return "Reduce the affected feature size or increase wall thickness and available spacing, then regenerate the mold.";
  }
  return "Review the technical detail, reduce the affected feature size, and regenerate. If the problem remains, try the default settings for that section.";
}
