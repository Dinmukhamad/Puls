import { PulsarCoach } from "../pages/crm/PulsarCoach";
import type { CoachStep } from "../pages/crm/coachTours";
import { SITE_TOUR } from "./siteTour";
import "../pages/crm/pulsar.css";
import "../pages/crm/coach.css";
import "./siteTour.css";

/** Pulsar over the whole site: loaded only when the tour runs, so its look costs other pages nothing. */
export default function SiteTourCoach({ onClose, onStep }: { onClose: (finished: boolean) => void; onStep: (step: CoachStep) => void }) {
  return <div className="site-tour"><PulsarCoach steps={SITE_TOUR} onClose={onClose} onStep={onStep} /></div>;
}
