if (process.env.NODE_ENV === "production") {
  const error = new Error("connector_sdk_test_support_forbidden");
  error.code = "connector_sdk_test_support_forbidden";
  throw error;
}
