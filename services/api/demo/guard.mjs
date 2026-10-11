if (process.env.NODE_ENV === "production") {
  throw new Error("demo_api_unavailable_in_production");
}
