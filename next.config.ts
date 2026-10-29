import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // Dev logs every Server Function call with its arguments, which would print the
    // login password and creator emails/messages to the terminal.
    serverFunctions: false,
  },
};

export default nextConfig;
