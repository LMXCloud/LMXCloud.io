export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

export const clerkAppearance = {
  variables: {
    colorPrimary: "#5B6BFF",
    colorBackground: "#14151C",
    colorInputBackground: "#14151C",
    colorText: "#F2F4F8",
    colorTextSecondary: "#9AA0AE",
    colorDanger: "#FF3A5C",
    borderRadius: "10px",
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
  },
  elements: {
    card: "shadow-none border border-[#2A2D38]",
    headerTitle: "text-[#F2F4F8]",
    headerSubtitle: "text-[#9AA0AE]",
    socialButtonsBlockButton:
      "border border-[#3A3D4A] bg-[#14151C] text-[#F2F4F8] hover:bg-[#1E2029]",
    formButtonPrimary:
      "bg-[#5B6BFF] hover:bg-[#7886FF] text-white shadow-none",
    footerActionLink: "text-[#7886FF] hover:text-[#7886FF]",
    identityPreviewEditButton: "text-[#5B6BFF]",
    formFieldInput:
      "border-[#2A2D38] bg-[#14151C] text-[#F2F4F8] focus:border-[#5B6BFF]",
  },
};
