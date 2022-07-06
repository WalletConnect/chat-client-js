const getPackageName = () => {
  return "chat-client";
};

const config = {
  entries: [
    {
      filePath: "./src/index.ts",
      outFile: `./dist/${getPackageName()}.d.ts`,
      noCheck: false,
    },
  ],
};

module.exports = config;
