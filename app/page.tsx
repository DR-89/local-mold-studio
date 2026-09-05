import type { Metadata } from "next";
import { MoldStudio } from "./MoldStudio";

export const metadata: Metadata = {
  title: "Two-part box mold",
  description:
    "Create printable multipart molds entirely locally in the browser.",
};

export default function Home() {
  return <MoldStudio />;
}
