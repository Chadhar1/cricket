import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import LiveMatches from "@/components/LiveMatches";
import Tournaments from "@/components/Tournaments";
import PopularPlayers from "@/components/PopularPlayers";
import HowItWorks from "@/components/HowItWorks";
import UpcomingMatches from "@/components/UpcomingMatches";
import Teams from "@/components/Teams";
import Community from "@/components/Community";
import Grounds from "@/components/Grounds";
import AIFeatures from "@/components/AIFeatures";
import Stats from "@/components/Stats";
import Marketplace from "@/components/Marketplace";
import Testimonials from "@/components/Testimonials";
import DownloadApp from "@/components/DownloadApp";
import Footer from "@/components/Footer";

// Section order follows the requested homepage hierarchy:
// Hero -> Featured/Live Tournaments (LiveMatches + Tournaments) ->
// Find Players -> How It Works -> Upcoming Matches -> Team discovery ->
// Community/achievements -> [platform-vision continuation, pre-existing] ->
// CTA + Footer (the CTA band lives inside Footer.tsx).
export default function Home() {
  return (
    <>
      <Navbar />
      <main className="relative overflow-x-clip">
        <Hero />
        <LiveMatches />
        <Tournaments />
        <PopularPlayers />
        <HowItWorks />
        <UpcomingMatches />
        <Teams />
        <Community />
        <Grounds />
        <AIFeatures />
        <Stats />
        <Marketplace />
        <Testimonials />
        <DownloadApp />
      </main>
      <Footer />
    </>
  );
}
