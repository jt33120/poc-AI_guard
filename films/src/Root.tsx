import { Composition } from "remotion";
import { ExtensionLoop, EXTENSION_SECONDS } from "./ExtensionLoop";
import { HomeFilm, HOME_SECONDS } from "./HomeFilm";
import { ProductsFilm, PRODUCTS_SECONDS } from "./ProductsFilm";
import { SignalSequence, SIGNAL_SECONDS } from "./SignalSequence";

const FILM = { fps: 24, width: 1920, height: 1080 };

export function Root() {
  return (
    <>
      {(["fr", "en"] as const).map((lang) => (
        <Composition key={`home-${lang}`} id={`home-${lang}`} component={HomeFilm} defaultProps={{ lang }} durationInFrames={HOME_SECONDS * FILM.fps} {...FILM} />
      ))}
      {(["fr", "en"] as const).map((lang) => (
        <Composition key={`products-${lang}`} id={`products-${lang}`} component={ProductsFilm} defaultProps={{ lang }} durationInFrames={PRODUCTS_SECONDS * FILM.fps} {...FILM} />
      ))}
      <Composition id="extension" component={ExtensionLoop} durationInFrames={EXTENSION_SECONDS * 30} fps={30} width={1920} height={1080} />
      {(["guarded", "unguarded"] as const).map((variant) => (
        <Composition key={variant} id={`signal-${variant}`} component={SignalSequence} defaultProps={{ variant }} durationInFrames={SIGNAL_SECONDS * 30} fps={30} width={1280} height={720} />
      ))}
    </>
  );
}
