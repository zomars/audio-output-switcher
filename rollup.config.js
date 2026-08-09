import deckyPlugin from "@decky/rollup";
import replace from "@rollup/plugin-replace";

// QAM_TAB=1 builds the variant that adds an icon to the QAM tab rail. Off by
// default, which lets rollup strip that code path entirely — see the README.
export default deckyPlugin({
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        __ENABLE_QAM_TAB__: process.env.QAM_TAB === "1" ? "true" : "false",
      },
    }),
  ],
});
