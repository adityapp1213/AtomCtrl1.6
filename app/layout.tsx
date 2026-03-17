import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter, Lora, Roboto_Mono } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const lora = Lora({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

const robotoMono = Roboto_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atom Ctrl",
  description: "Ai assistant that actually does Stuff!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${inter.variable} ${lora.variable} ${robotoMono.variable} antialiased`}
          suppressHydrationWarning
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}









































// import type { Metadata } from "next";
// import { ClerkProvider } from "@clerk/nextjs";
// import { Geist, Geist_Mono } from "next/font/google";
// import "./globals.css";

// const geistSans = Geist({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
// });

// const geistMono = Geist_Mono({
//   variable: "--font-geist-mono",
//   subsets: ["latin"],
// });

// export const metadata: Metadata = {
//   title: "Atom Ctrl",
//   description: "Ai assistant that actually does Stuff!",
// };

// export default function RootLayout({
//   children,
// }: Readonly<{ children: React.ReactNode }>) {
//   return (
//     <ClerkProvider>
//       <html lang="en">
//         <body
//           className={`${geistSans.variable} ${geistMono.variable} antialiased`}
//           style={{
//             ['--secondary-bg' as any]: '#F6F5F3',
//             ['--secondary-yellow' as any]: '#FFF1A8',
//             ['--secondary-green' as any]: '#BFF2B6',
//             ['--secondary-pink' as any]: '#FFD9EF',
//             ['--secondary-lavender' as any]: '#E8E4FF',
//             ['--secondary-text' as any]: '#111111',
//           }}
//         >
//           {children}
//         </body>
//       </html>
//     </ClerkProvider>
//   );
// }
