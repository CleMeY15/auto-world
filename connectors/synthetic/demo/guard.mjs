if (process.env.NODE_ENV === "production") {
  const error = new Error("synthetic_connector_demo_forbidden");
  error.code = "synthetic_connector_demo_forbidden";
  throw error;
}
