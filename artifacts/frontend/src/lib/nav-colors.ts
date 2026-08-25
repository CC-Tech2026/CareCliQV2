// Shared between settings.tsx (the picker in Branding > Layout) and
// HubLayout.tsx (the actual nav render) so the preview and the real thing
// can never drift apart. "Indigo Night" needs its own hex constant because
// it gets a distinct scheme (solid indigo active pill + lavender text)
// instead of the generic dark-background contrast fallback every other
// dark preset uses.
export const NAV_INDIGO_NIGHT_HEX = "#161320";
