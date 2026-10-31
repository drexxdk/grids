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
      title="Crop image"
      onClose={() => setOpen(false)}
      onExited={onClose}
      returnFocus={returnFocus}
    >
      <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">
        <div
          className="tw:relative tw:min-h-0 tw:flex-1 tw:bg-[#101112]"
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
              className="tw:absolute tw:inset-x-0 tw:top-4 tw:z-10 tw:m-0 tw:text-center"
            >
              Image could not load.
            </p>
          )}
        </div>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:border-0 tw:border-t tw:border-solid tw:border-(--line) tw:bg-(--panel) tw:p-3 tw:pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="tw:flex tw:min-w-[160px] tw:flex-1 tw:items-center tw:gap-3 tw:max-[600px]:basis-full">
            <label htmlFor="crop-zoom" className="tw:shrink-0">
              Zoom
            </label>
            <input
              id="crop-zoom"
              className="tw:h-[44px] tw:min-w-0 tw:flex-1"
              type="range"
              min="1"
              max="8"
              step="0.01"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <output className="tw:w-12 tw:shrink-0 tw:text-right">
              {Math.round(zoom * 100)}%
            </output>
          </div>
          <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-3 tw:max-[600px]:w-full tw:max-[600px]:justify-end">
            <Button
              variant="icon"
              title="Toggle crop guides"
              aria-label="Toggle crop guides"
              aria-pressed={grid}
              onClick={() => setGrid(!grid)}
            >
              <Grid3X3 aria-hidden="true" />
            </Button>
            <Button
              variant="icon"
              title="Reset crop"
              aria-label="Reset crop"
              onClick={() => {
                setInitialArea(undefined);
                setPosition({ x: 0, y: 0 });
                setZoom(1);
              }}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
            <Button className="tw:min-h-[44px]" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="tw:min-h-[44px]"
              variant="primary"
              disabled={!ready || error || !draft}
              onClick={() => {
                if (draft) {
                  onApply(draft);
                  setOpen(false);
                }
              }}
            >
              <Check aria-hidden="true" />
              Apply crop
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
