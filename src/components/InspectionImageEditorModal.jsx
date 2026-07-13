import React, { useEffect, useRef, useState } from 'react';
import { renderModalPortal } from './AppDialogs.jsx';

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

export default function InspectionImageEditorModal({ draft, saving, onClose, onSave }) {
  const [imageElement, setImageElement] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [imageBounds, setImageBounds] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [error, setError] = useState('');
  const previewCanvasRef = useRef(null);
  const cropImageRef = useRef(null);
  const cropWorkspaceRef = useRef(null);
  const dragStartRef = useRef(null);

  useEffect(() => {
    if (!draft?.src) {
      setImageElement(null);
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setImageElement(image);
      setRotation(0);
      setCrop({
        x: 0,
        y: 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      if (!cancelled) {
        setError('Unable to load this image for editing.');
      }
    };
    image.src = draft.src;
    return () => {
      cancelled = true;
    };
  }, [draft]);

  useEffect(() => {
    function updateImageBounds() {
      const imageNode = cropImageRef.current;
      const workspaceNode = cropWorkspaceRef.current;
      if (!imageNode || !workspaceNode) return;
      const imageRect = imageNode.getBoundingClientRect();
      const workspaceRect = workspaceNode.getBoundingClientRect();
      setImageBounds({
        width: imageRect.width,
        height: imageRect.height,
        left: imageRect.left - workspaceRect.left,
        top: imageRect.top - workspaceRect.top,
      });
    }

    updateImageBounds();
    window.addEventListener('resize', updateImageBounds);
    return () => window.removeEventListener('resize', updateImageBounds);
  }, [imageElement, draft]);

  useEffect(() => {
    if (!imageElement || !previewCanvasRef.current || !crop.width || !crop.height) return;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = crop.width;
    sourceCanvas.height = crop.height;
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) return;
    sourceContext.drawImage(
      imageElement,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );

    const normalizedRotation = ((rotation % 360) + 360) % 360;
    const rotatedCanvas = document.createElement('canvas');
    const swapSides = normalizedRotation === 90 || normalizedRotation === 270;
    rotatedCanvas.width = swapSides ? crop.height : crop.width;
    rotatedCanvas.height = swapSides ? crop.width : crop.height;
    const rotatedContext = rotatedCanvas.getContext('2d');
    if (!rotatedContext) return;
    rotatedContext.save();
    rotatedContext.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
    rotatedContext.rotate((normalizedRotation * Math.PI) / 180);
    rotatedContext.drawImage(sourceCanvas, -crop.width / 2, -crop.height / 2);
    rotatedContext.restore();

    const previewCanvas = previewCanvasRef.current;
    const maxWidth = 560;
    const scale = Math.min(1, maxWidth / rotatedCanvas.width);
    previewCanvas.width = Math.max(1, Math.round(rotatedCanvas.width * scale));
    previewCanvas.height = Math.max(1, Math.round(rotatedCanvas.height * scale));
    const previewContext = previewCanvas.getContext('2d');
    if (!previewContext) return;
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(rotatedCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
  }, [crop, imageElement, rotation]);

  async function handleSave() {
    if (!imageElement || !crop.width || !crop.height) return;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = crop.width;
    sourceCanvas.height = crop.height;
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) return;
    sourceContext.drawImage(
      imageElement,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );

    const normalizedRotation = ((rotation % 360) + 360) % 360;
    const outputCanvas = document.createElement('canvas');
    const swapSides = normalizedRotation === 90 || normalizedRotation === 270;
    outputCanvas.width = swapSides ? crop.height : crop.width;
    outputCanvas.height = swapSides ? crop.width : crop.height;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) return;
    outputContext.save();
    outputContext.translate(outputCanvas.width / 2, outputCanvas.height / 2);
    outputContext.rotate((normalizedRotation * Math.PI) / 180);
    outputContext.drawImage(sourceCanvas, -crop.width / 2, -crop.height / 2);
    outputContext.restore();

    const outputType = String(draft.attachment?.type || '').startsWith('image/') ? draft.attachment.type : 'image/png';
    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, outputType, 0.92));
    if (!blob) {
      setError('Unable to save image edits.');
      return;
    }
    onSave(blob);
  }

  function getPointInImage(event) {
    const workspaceNode = cropWorkspaceRef.current;
    if (!workspaceNode || !imageElement || !imageBounds.width || !imageBounds.height) return null;
    const workspaceRect = workspaceNode.getBoundingClientRect();
    const xInWorkspace = event.clientX - workspaceRect.left;
    const yInWorkspace = event.clientY - workspaceRect.top;
    const xInImage = xInWorkspace - imageBounds.left;
    const yInImage = yInWorkspace - imageBounds.top;
    if (xInImage < 0 || yInImage < 0 || xInImage > imageBounds.width || yInImage > imageBounds.height) return null;
    const scaleX = imageElement.naturalWidth / imageBounds.width;
    const scaleY = imageElement.naturalHeight / imageBounds.height;
    return {
      x: clamp(Math.round(xInImage * scaleX), 0, imageElement.naturalWidth),
      y: clamp(Math.round(yInImage * scaleY), 0, imageElement.naturalHeight),
    };
  }

  function beginCropDrag(event) {
    const point = getPointInImage(event);
    if (!point) return;
    dragStartRef.current = point;
    setCrop({ x: point.x, y: point.y, width: 1, height: 1 });
  }

  function continueCropDrag(event) {
    if (!dragStartRef.current || !imageElement) return;
    const point = getPointInImage(event);
    if (!point) return;
    const start = dragStartRef.current;
    const nextX = Math.min(start.x, point.x);
    const nextY = Math.min(start.y, point.y);
    const nextWidth = Math.max(1, Math.abs(point.x - start.x));
    const nextHeight = Math.max(1, Math.abs(point.y - start.y));
    setCrop({
      x: clamp(nextX, 0, imageElement.naturalWidth - 1),
      y: clamp(nextY, 0, imageElement.naturalHeight - 1),
      width: Math.min(nextWidth, imageElement.naturalWidth - nextX),
      height: Math.min(nextHeight, imageElement.naturalHeight - nextY),
    });
  }

  function endCropDrag() {
    dragStartRef.current = null;
  }

  const cropOverlayStyle =
    imageElement && imageBounds.width && imageBounds.height
      ? {
          left: `${imageBounds.left + (crop.x / imageElement.naturalWidth) * imageBounds.width}px`,
          top: `${imageBounds.top + (crop.y / imageElement.naturalHeight) * imageBounds.height}px`,
          width: `${(crop.width / imageElement.naturalWidth) * imageBounds.width}px`,
          height: `${(crop.height / imageElement.naturalHeight) * imageBounds.height}px`,
        }
      : null;

  if (!draft) return null;

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card inspection-image-editor-modal" role="dialog" aria-modal="true" aria-labelledby="inspection-image-editor-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Inspection Image</p>
            <h2 id="inspection-image-editor-title">{draft.title}</h2>
          </div>
        </div>

        {error ? <div className="error-banner"><strong>Error.</strong><span>{error}</span></div> : null}

        <div className="inspection-image-editor-grid">
          <div
            ref={cropWorkspaceRef}
            className="inspection-crop-workspace"
            onPointerDown={beginCropDrag}
            onPointerMove={continueCropDrag}
            onPointerUp={endCropDrag}
            onPointerLeave={endCropDrag}
          >
            <img
              ref={cropImageRef}
              className="inspection-crop-image"
              src={draft.src}
              alt={draft.title}
              onLoad={() => {
                const imageNode = cropImageRef.current;
                const workspaceNode = cropWorkspaceRef.current;
                if (!imageNode || !workspaceNode) return;
                const imageRect = imageNode.getBoundingClientRect();
                const workspaceRect = workspaceNode.getBoundingClientRect();
                setImageBounds({
                  width: imageRect.width,
                  height: imageRect.height,
                  left: imageRect.left - workspaceRect.left,
                  top: imageRect.top - workspaceRect.top,
                });
              }}
            />
            {cropOverlayStyle ? <div className="inspection-crop-overlay" style={cropOverlayStyle} /> : null}
          </div>
          <div className="inspection-image-editor-preview">
            <canvas ref={previewCanvasRef} />
          </div>
          <div className="inspection-image-editor-controls">
            <div className="panel-actions">
              <button className="button secondary" type="button" onClick={() => setRotation((current) => current - 90)}>
                Rotate left
              </button>
              <button className="button secondary" type="button" onClick={() => setRotation((current) => current + 90)}>
                Rotate right
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  imageElement
                    ? setCrop({ x: 0, y: 0, width: imageElement.naturalWidth, height: imageElement.naturalHeight })
                    : null
                }
              >
                Reset crop
              </button>
            </div>

            <div className="inspection-crop-help">
              <strong>Crop visually</strong>
              <p>Drag across the image to choose the crop area. The right preview updates with your crop and rotation.</p>
            </div>
          </div>
        </div>

        <div className="panel-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={handleSave} disabled={saving || !imageElement}>
            {saving ? 'Saving...' : 'Save image'}
          </button>
        </div>
      </div>
    </div>,
  );
}


