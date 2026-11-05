if (process.env.NODE_ENV === "production") {
  throw new Error("prototype_production_forbidden");
}

export {};
