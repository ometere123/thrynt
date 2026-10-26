import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={
  title:"THRYNT — Set the condition. Prove the execution.",
  description:"Event-driven DreamDEX perpetual trading automation with auditable decisions on Somnia.",
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
