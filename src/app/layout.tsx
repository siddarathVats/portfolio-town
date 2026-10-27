import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "lenis/dist/lenis.css";
import "./globals.css";
import { SiteAnalytics } from "@/components/SiteAnalytics";

// Geist (Vercel's typeface: a clean neo-grotesque in the spirit of Apple's SF) for everything, its mono
// for the small labels; preloaded, as the first thing on screen is set in them.
const sans = Geist({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Siddarath Vats · AI Engineer",
  description:
    "Portfolio of Siddarath Vats, AI engineer building agents, retrieval systems and machine learning. Run through a little town, up the hill road and into the woods to see the work.",
  // Installable as an app (app/manifest.ts): full screen from the home screen, its own icon.
  applicationName: "Siddarath Vats",
  appleWebApp: { capable: true, title: "Siddarath", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "Siddarath Vats · AI Engineer",
    description: "A walk through a hand-built 3D town: AI agents, search and machine-learning projects.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#5cc4bb",
  width: "device-width",
  initialScale: 1,
  // (drawn edge to edge on notched phones; globals.css keeps the overlays inside the safe area)
  viewportFit: "cover",
};

/**
 * ?vclock (tests only): the page's clock (animation frames, performance.now, Date.now, timers) can be
 * taken over and stepped by hand (`__vclock.start()`, then `__vclock.advance(frames)`), so a test can
 * play everything, the 3D, the scroll-driven cards, the autopilot, in lock-step at exact 60 fps
 * however slowly the browser actually draws. Untouched otherwise.
 */
const VCLOCK = `(function(){if(!/[?&]vclock/.test(location.search))return;
var W=window,P=performance,rN=P.now.bind(P),rD=Date.now,rR=W.requestAnimationFrame.bind(W),rC=W.cancelAnimationFrame.bind(W),rT=W.setTimeout.bind(W),rX=W.clearTimeout.bind(W),rI=W.setInterval.bind(W),rY=W.clearInterval.bind(W);
var on=false,t=0,d0=0,q=[],id=1e6,tm=[];
W.requestAnimationFrame=function(cb){if(!on)return rR(cb);q.push([++id,cb]);return id};
W.cancelAnimationFrame=function(i){if(i>1e6)q=q.filter(function(e){return e[0]!==i});else rC(i)};
P.now=function(){return on?t:rN()};Date.now=function(){return on?d0+t:rD()};
W.setTimeout=function(f,ms){if(!on||typeof f!=="function")return rT.apply(W,arguments);var a=[].slice.call(arguments,2);tm.push({id:++id,at:t+(+ms||0),f:f,a:a});return id};
W.clearTimeout=function(i){if(i>1e6)tm=tm.filter(function(e){return e.id!==i});else rX(i)};
W.setInterval=function(f,ms){if(!on)return rI.apply(W,arguments);var e={id:++id,at:t+(+ms||0),f:f,a:[],every:Math.max(1,+ms||0)};tm.push(e);return e.id};
W.clearInterval=function(i){if(i>1e6)tm=tm.filter(function(e){return e.id!==i});else rY(i)};
W.__vclock={start:function(){if(on)return;t=rN();d0=rD()-t;on=true},
advance:function(n,after){n=n||1;for(var k=0;k<n;k++){t+=1000/60;
for(var g=0;g<50;g++){var due=tm.filter(function(e){return e.at<=t});if(!due.length)break;due.forEach(function(e){if(e.every)e.at+=e.every;else tm=tm.filter(function(x){return x!==e});try{e.f.apply(W,e.a)}catch(x){console.error(x)}})}
W.dispatchEvent(new Event("scroll"));var run=q;q=[];run.forEach(function(e){try{e[1](t)}catch(x){console.error(x)}});if(after)after(k)}return t},
get t(){return t}};})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <head>
        {/* Panels become fixed, scroll-driven overlays only when JS runs; without JS they read as a normal page. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        <script dangerouslySetInnerHTML={{ __html: VCLOCK }} />
      </head>
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
