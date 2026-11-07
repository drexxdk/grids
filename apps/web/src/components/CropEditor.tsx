import { t } from "../i18n";
import Cropper, { type Area } from "react-easy-crop";
import { Check, Grid3X3, RotateCcw } from "lucide-react";
import { useState, type RefObject } from "react";
import { cropSchema, type Asset, type ImageCrop } from "../model";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/controls";

export function CropEditor({
  asset,
  aspect,
  initialCrop,
  onApply,
  onClose,
  returnFocus,
}: {
  asset: Asset;
  aspect: number;
  initialCrop?: ImageCrop;
  onApply: (crop: ImageCrop) => void;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(true);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<ImageCrop | null>(null);
  const [initialArea, setInitialArea] = useState<Area | undefined>(() =>
    initialCrop
      ? {
          x: initialCrop.x * 100,
          y: initialCrop.y * 100,
          width: initialCrop.width * 100,
          height: initialCrop.height * 100,
        }
      : undefined,
  );
  const updateDraft = (area: Area) => {
    const result = cropSchema.safeParse({
      x: area.x / 100,
      y: area.y / 100,
      width: area.width / 100,
      height: area.height / 100,
    });
    if (result.success) setDraft(result.data);
  };
  return (
    <Modal
      fullscreen
      open={open}
      title={t("crop.title")}
      onClose={() => setOpen(false)}
      onExited={onClose}
      returnFocus={returnFocus}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="relative min-h-0 flex-1 bg-ui-background"
          data-crop-stage
        >
          <Cropper
            image={asset.src}
            crop={position}
            zoom={zoom}
            aspect={aspect}
            minZoom={1}
            maxZoom={8}
            showGrid={grid}
            onCropChange={setPosition}
            onZoomChange={setZoom}
            initialCroppedAreaPercentages={initialArea}
            onCropAreaChange={updateDraft}
            onCropComplete={updateDraft}
            onMediaLoaded={() => setReady(true)}
            mediaProps={{ onError: () => setError(true), alt: asset.title }}
            cropperProps={{ "aria-label": "Crop preview", tabIndex: 0 }}
            classes={{ cropAreaClassName: "crop-window" }}
          />
          {error && (
            <p
              role="alert"
              className="absolute inset-x-0 top-4 z-10 m-0 text-center"
            >
              {t("crop.loadError")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-ui-border bg-ui-panel p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex min-w-40 flex-1 items-center gap-3 max-[600px]:basis-full">
            <label htmlFor="crop-zoom" className="shrink-0">
              {t("crop.zoom")}
            </label>
            <input
              id="crop-zoom"
              className="h-11 min-w-0 flex-1"
              type="range"
              min="1"
              max="8"
              step="0.01"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <output className="w-12 shrink-0 text-right">
              {Math.round(zoom * 100)}%
            </output>
          </div>
          <div className="flex shrink-0 items-center gap-3 max-[600px]:w-full max-[600px]:justify-end">
            <Button
              presentation="icon"
              title={t("crop.guides")}
              aria-label={t("crop.guides")}
              aria-pressed={grid}
              onClick={() => setGrid(!grid)}
            >
              <Grid3X3 aria-hidden="true" />
            </Button>
            <Button
              presentation="icon"
              title={t("crop.reset")}
              aria-label={t("crop.reset")}
              onClick={() => {
                setInitialArea(undefined);
                setPosition({ x: 0, y: 0 });
                setZoom(1);
              }}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
            <Button onClick={() => setOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              className="min-h-11"
              intent="primary"
              disabled={!ready || error || !draft}
              onClick={() => {
                if (draft) {
                  onApply(draft);
                  setOpen(false);
                }
              }}
            >
              <Check aria-hidden="true" />
              {t("crop.apply")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
