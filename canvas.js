$(document).ready(() => {
    // Generate Session ID
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    $('.shopify-product-form').append(`<input type="hidden" name="properties[File Type]" value="${FILE_TYPE}" />`)
    $('.shopify-product-form').append('<input type="hidden" name="properties[_dtf_type]" value="canvas" />')
    $('.shopify-product-form').append(`<input type="hidden" class="session_id" name="properties[_dtf_session_id]" value="${sessionId}" />`);
    $('.product-info__quantity-selector').css('display','none')

    const canvas = $('#nw-canvas');
    $('body').prepend(canvas);

    $("#nw-canvas-trg").on('click', function () {
        $('#nw-canvas').fadeIn(200, function () {
            // Center canvas after it becomes visible and has dimensions
            autoScale();
            updateUI();
        });
    })

    /**
     * APP STATE & CONSTANTS
     */
    const PX_PER_CM = 37.79;
    const GAP_CM = 1.0;
    const FALLBACK_DPI = 300;

    const FORMATS = [
        { id: 'custom', name: '56 x 100 cm', width: 56, height: 100, price: 19.90 },
        { id: 'a4', name: 'DIN A4 (21 x 29.7 cm)', width: 21.0, height: 29.7, price: 7.90 },
        { id: 'a3', name: 'DIN A3 (29.7 x 42 cm)', width: 29.7, height: 42.0, price: 12.50 },
    ];

    let state = {
        selectedFormat: FORMATS[0],
        printSmallElements: true,
        items: [],
        savedSheets: [],
        currentSheetIndex: null, // null = new sheet, index = editing a saved sheet
        selectedItemId: null,
        zoom: 0.5,
        originalSheetSnapshot: null,
        // Pan state (Figma-style)
        panX: 0,
        panY: 0,
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        panStartPanX: 0,
        panStartPanY: 0,
        // Drag state
        isDragging: false,
        dragOffset: { x: 0, y: 0 },
        collidingIds: [],
        // Resize state
        isResizing: false,
        resizeHandle: null,
        resizeStartPos: { x: 0, y: 0 },
        resizeStartSize: { w: 0, h: 0 },
        resizeStartItemPos: { x: 0, y: 0 },
        aspectRatioLocked: true,
        manualMode: true,
        // Rotation state (no longer used for drag, kept for compatibility)
        isRotating: false,
        rotateStartAngle: 0,
        rotateItemStartAngle: 0,
        rotateCenter: { x: 0, y: 0 }
    };

    /**
     * UTILS
     */
    const cmToPx = cm => cm * PX_PER_CM;
    const pxToCm = px => px / PX_PER_CM;
    const generateId = (prefix = 'item') => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const getSheetHash = (items, format) => {
        const payload = {
            format: { w: format.width, h: format.height },
            items: items.map(i => ({ x: i.x, y: i.y, w: i.width, h: i.height, r: i.rotation, g: i.groupId, s: i.src, q: i.quantity }))
        };
        return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    };
    const API_UPLOAD_URL = 'https://dtfworld.hamzadeveloper.com/api/upload-chunk';
    const API_FINALIZE_URL = 'https://dtfworld.hamzadeveloper.com/api/upload-chunk/finalize';
    async function uploadFileInChunks(file, productId, dimensions, sessionId, chunkSize, id) {
        let visualProgress = 0;
        const smoothUpdate = (target) => {
            visualProgress += (target - visualProgress) * 0.15;
            const $bar = $(`.file_percent_${id}`);
            const $label = $(`.file_percent_label_${id}`);
            if ($bar.length) $bar.css('width', `${visualProgress}%`);
            if ($label.length) $label.text(`${visualProgress.toFixed(1)}%`);
        };
        const totalChunks = Math.ceil(file.size / chunkSize);
        const UPLOAD_PERCENT = 90;
        let uploadedBytes = 0;
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            const formData = new FormData();
            formData.append('file', chunk);
            formData.append('fileName', file.name);
            formData.append('chunkIndex', i);
            formData.append('totalChunks', totalChunks);
            formData.append('sessionId', sessionId);
            const resp = await fetch(API_UPLOAD_URL, { method: 'POST', body: formData });
            if (!resp.ok) throw new Error(`Chunk ${i} upload failed`);
            uploadedBytes += chunk.size;
            const percent = Math.min((uploadedBytes / file.size) * UPLOAD_PERCENT, UPLOAD_PERCENT);
            smoothUpdate(percent);
        }
        const finalizeResp = await fetch(API_FINALIZE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalFileName: file.name, sessionId, productId, dimensions })
        });
        if (!finalizeResp.ok) throw new Error('Finalize upload failed');
        smoothUpdate(100);
        return await finalizeResp.json();
    }
    async function newUploadFile(file, id) {
        const productId = $('.shopify-product-form input[name="id"]').val();
        const sessionId = $('.session_id').val();
        const dims = {
            widthCm: state.selectedFormat.width,
            heightCm: state.selectedFormat.height,
            widthPx: Math.round(cmToPx(state.selectedFormat.width)),
            heightPx: Math.round(cmToPx(state.selectedFormat.height))
        };
        const dimsString = `${state.selectedFormat.width} cm x ${state.selectedFormat.height} cm`;
        const res = await uploadFileInChunks(file, productId, dimsString, sessionId, 1024 * 1024, id);
        if (res) {
            if (typeof window.UpdateFileMeta === 'function') {
                window.UpdateFileMeta(id, 'uploaded_name', res.fileName);
                window.UpdateFileMeta(id, 'fileId', res.fileId);
                window.UpdateFileMeta(id, 'tempUrl', res.tempUrl);
                window.UpdateFileMeta(id, 'status', 'Uploaded');
                window.UpdateFileMeta(id, 'imagesCount', res.pdfCount);
            }
            $(`.del_file_${id}`).attr('fid', res.fileId);
            $('.shopify-product-form').append(`<input type="hidden" class="file_input_${id}" name="properties[Width_${id}]" value="${dims.widthCm}" />`);
            $('.shopify-product-form').append(`<input type="hidden" class="file_input_${id}" name="properties[Height_${id}]" value="${dims.heightCm}" />`);
            $('.shopify-product-form').append(`<input type="hidden" class="file_input_${id}" name="properties[_File_${id}]" value="${res.tempUrl}" />`);
            $('.shopify-product-form').append(`<input type="hidden" class="file_input_${id}" name="properties[_dtf_file_name_${id}]" value="${res.fileName}" />`);
            $(`.fs_loader_${id}`).fadeOut(100);
            $(`.fs_uploaded_${id}`).fadeIn(100);
            $(`.fileInput_${id}`).val('');
            if (typeof window.UpdateTotalFiles === 'function') window.UpdateTotalFiles(id);
            return res;
        } else {
            $(`.fs_loader_${id}`).fadeOut(100);
            $(`.fs_failed_${id}`).fadeIn(100);
            return null;
        }
    }
    const renderSheetToImage = async (sheet) => {
        const widthPx = Math.round(cmToPx(sheet.format.width));
        const heightPx = Math.round(cmToPx(sheet.format.height));
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, widthPx, heightPx);
        for (const item of sheet.items) {
            if (!item.src) continue;
            const img = await new Promise(resolve => {
                const im = new Image();
                im.crossOrigin = 'anonymous';
                im.onload = () => resolve(im);
                im.src = item.src;
            });
            const x = cmToPx(item.x);
            const y = cmToPx(item.y);
            const w = cmToPx(item.width);
            const h = cmToPx(item.height);
            const rad = (item.rotation || 0) * Math.PI / 180;
            ctx.save();
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate(rad);
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
            ctx.restore();
        }
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.92));
        const fileName = `sheet_${Date.now()}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        return { file, fileName };
    };
    const saveCurrentSheet = async () => {
        let sheet = null;
        if (state.currentSheetIndex !== null) {
            sheet = state.savedSheets[state.currentSheetIndex];
            sheet.items = [...state.items];
            sheet.format = state.selectedFormat;
        } else {
            if (!state.items.length) return null;
            sheet = { id: Date.now(), format: state.selectedFormat, items: [...state.items], price: state.selectedFormat.price };
            state.savedSheets.push(sheet);
            state.currentSheetIndex = state.savedSheets.length - 1;
        }
        const hash = getSheetHash(sheet.items, sheet.format);
        const { file, fileName } = await renderSheetToImage(sheet);
        let uploadRes = null;
        try {
            const sheetIdx = state.savedSheets.indexOf(sheet) + 1;
            uploadRes = await newUploadFile(file, sheetIdx);
        } catch (e) {
            uploadRes = null;
        }
        let tempUrl = null;
        let fileId = null;
        let savedFileName = fileName;
        if (uploadRes && uploadRes.tempUrl) {
            tempUrl = uploadRes.tempUrl;
            fileId = uploadRes.fileId || null;
            if (uploadRes.fileName) {
                savedFileName = uploadRes.fileName;
            }
        } else {
            tempUrl = URL.createObjectURL(file);
        }
        sheet.savedUrl = tempUrl;
        sheet.savedFileName = savedFileName;
        sheet.fileId = fileId;
        sheet.lastSavedHash = hash;
        sheet.options = {
            formatId: state.selectedFormat.id,
            formatName: state.selectedFormat.name,
            width: state.selectedFormat.width,
            height: state.selectedFormat.height,
            printSmallElements: state.printSmallElements
        };
        const $form = $('.shopify-product-form');
        if ($form.length) {
            const idx = state.savedSheets.indexOf(sheet) + 1;
        //     $form.append(`<input type="hidden" name="properties[_Frame_${idx + 1}_Url]" value="${tempUrl}">`);
        //     $form.append(`<input type="hidden" name="properties[_Frame_${idx + 1}_Name]" value="${savedFileName}">`);
        //     $form.append(`<input type="hidden" name="properties[Frame ${idx + 1} Width]" value="${sheet.format.width}">`);
        //     $form.append(`<input type="hidden" name="properties[Frame ${idx + 1} Height]" value="${sheet.format.height}">`);
        //     $form.append(`<input type="hidden" name="properties[Frame ${idx + 1} Format]" value="${sheet.options.formatName}">`);
            $form.append(`<input type="hidden" class="print_type_${idx}" name="properties[Print_Type_${idx}]" value="${sheet.options.printSmallElements ? 'Ja' : 'Nein'}">`);
        }
        return sheet;
    };
    const showToast = (text, type = 'success') => {
        const bg = type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-slate-700' : 'bg-green-600';
        const $toast = $(`<div class="fixed top-4 right-4 z-[999999] ${bg} text-white px-4 py-2 rounded-lg shadow-lg">${text}</div>`);
        $('body').append($toast);
        setTimeout(() => { $toast.fadeOut(200, () => $toast.remove()); }, 2000);
    };
    const isCurrentSheetDirty = () => {
        if (state.currentSheetIndex === null) return state.items.length > 0;
        const sheet = state.savedSheets[state.currentSheetIndex];
        if (!sheet) return false;
        const currentHash = getSheetHash(state.items, state.selectedFormat);
        const savedHash = sheet.lastSavedHash || getSheetHash(sheet.items, sheet.format);
        return currentHash !== savedHash;
    };
    let pendingGuardNext = null;
    const openUnsavedModal = (next) => {
        pendingGuardNext = next;
        $('#unsaved-modal').removeClass('hidden');
        lucide.createIcons();
    };
    const closeUnsavedModal = () => {
        $('#unsaved-modal').addClass('hidden');
        pendingGuardNext = null;
    };
    const guardUnsavedChanges = (next) => {
        if (!isCurrentSheetDirty()) { next(); return; }
        openUnsavedModal(next);
    };

    // Image compression to reduce memory usage - compresses large images
    const compressImage = (file, maxWidth = 2000, quality = 0.8) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // If image is small enough, use original
                    if (img.naturalWidth <= maxWidth && file.size < 500000) {
                        resolve({ dataUrl: e.target.result, width: img.naturalWidth, height: img.naturalHeight });
                        return;
                    }

                    // Calculate new dimensions
                    let width = img.naturalWidth;
                    let height = img.naturalHeight;
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    // Use OffscreenCanvas if available for better performance
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG for better file size (except PNG with transparency)
                    const isPNG = file.type === 'image/png';
                    const outputType = isPNG ? 'image/png' : 'image/jpeg';
                    const dataUrl = canvas.toDataURL(outputType, isPNG ? 1 : quality);

                    resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
                };
                img.onerror = () => resolve({ dataUrl: e.target.result, width: 100, height: 100 });
                img.src = e.target.result;
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    };

    const detectImageDPI = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsArrayBuffer(file.slice(0, 50000));
            reader.onload = (e) => {
                const view = new DataView(e.target.result);
                try {
                    if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
                        let offset = 8;
                        while (offset < view.byteLength) {
                            const length = view.getUint32(offset);
                            const type = view.getUint32(offset + 4);
                            if (type === 0x70485973) {
                                const ppuX = view.getUint32(offset + 8);
                                const unit = view.getUint8(offset + 16);
                                if (unit === 1) { resolve(Math.round(ppuX * 0.0254)); return; }
                            }
                            offset += 12 + length;
                        }
                    }
                    if (view.getUint16(0) === 0xFFD8) {
                        let offset = 2;
                        while (offset < view.byteLength) {
                            const marker = view.getUint16(offset);
                            const length = view.getUint16(offset + 2);
                            if (marker === 0xFFE0) {
                                if (view.getUint32(offset + 4) === 0x4A464946) {
                                    const units = view.getUint8(offset + 11);
                                    const xDensity = view.getUint16(offset + 12);
                                    if (units === 1) { resolve(xDensity); return; }
                                    else if (units === 2) { resolve(Math.round(xDensity * 2.54)); return; }
                                }
                            }
                            offset += 2 + length;
                        }
                    }
                } catch (err) { }
                resolve(null);
            };
            reader.onerror = () => resolve(null);
        });
    };

    // Get effective bounding box size for any rotation angle
    const getEffectiveSize = (item) => {
        const rotation = item.rotation || 0;
        const radians = (rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        return {
            width: item.width * cos + item.height * sin,
            height: item.width * sin + item.height * cos
        };
    };

    // Generate resize handles + rotation handle HTML
    const createResizeHandles = () => {
        const handles = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];
        let html = handles.map(h => `<div class="item-handle handle-${h}" data-handle="${h}"></div>`).join('');
        // Add rotation connector line and handle
        html += `<div class="rotate-connector"></div>`;
        html += `<div class="item-handle handle-rotate" data-handle="rotate"></div>`;
        return html;
    };

    // Rotate item by 90° clockwise on click (predefined angles: 0°, 90°, 180°, 270°)
    const rotateBy90 = (item, e) => {
        e.stopPropagation();
        state.selectedItemId = item.id;
        const currentRotation = item.rotation || 0;
        // Rotate 90° clockwise, wrap at 360°
        const newRotation = (currentRotation + 90) % 360;
        state.items = state.items.map(i => i.id === item.id ? { ...i, rotation: newRotation } : i);
        updateUI();
    };

    // Constrain item within canvas boundaries (properly handles rotation)
    const constrainToBounds = (item, newX, newY, newW, newH) => {
        const { width: formatW, height: formatH } = state.selectedFormat;

        // Calculate rotated bounding box dimensions
        const rotation = item.rotation || 0;
        const radians = (rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));

        // Actual bounding box of rotated rectangle
        const boundingW = newW * cos + newH * sin;
        const boundingH = newW * sin + newH * cos;

        // Offset from item position to bounding box top-left
        const offsetX = (boundingW - newW) / 2;
        const offsetY = (boundingH - newH) / 2;

        // Constrain position so rotated bounding box stays within canvas
        let constrainedX = newX;
        let constrainedY = newY;

        // Left edge: item.x - offsetX >= 0
        if (newX - offsetX < 0) constrainedX = offsetX;
        // Top edge: item.y - offsetY >= 0
        if (newY - offsetY < 0) constrainedY = offsetY;
        // Right edge: item.x + newW + offsetX <= formatW
        if (newX + newW + offsetX > formatW) constrainedX = formatW - newW - offsetX;
        // Bottom edge: item.y + newH + offsetY <= formatH
        if (newY + newH + offsetY > formatH) constrainedY = formatH - newH - offsetY;

        // Clamp to valid range
        constrainedX = Math.max(offsetX, Math.min(constrainedX, formatW - newW - offsetX));
        constrainedY = Math.max(offsetY, Math.min(constrainedY, formatH - newH - offsetY));

        // Constrain dimensions if too large
        const maxW = formatW - 2 * offsetX;
        const maxH = formatH - 2 * offsetY;
        const constrainedW = Math.min(newW, maxW);
        const constrainedH = Math.min(newH, maxH);

        return {
            x: parseFloat(constrainedX.toFixed(2)),
            y: parseFloat(constrainedY.toFixed(2)),
            width: parseFloat(Math.max(0.5, constrainedW).toFixed(2)),
            height: parseFloat(Math.max(0.5, constrainedH).toFixed(2))
        };
    };

    // Throttled update via requestAnimationFrame
    const throttledUpdate = (() => {
        let pending = false;
        return (callback) => {
            if (!pending) {
                pending = true;
                requestAnimationFrame(() => { callback(); pending = false; });
            }
        };
    })();

    // Calculate new dimensions during resize based on handle
    // Corner handles: respect aspect ratio lock
    // Edge handles: ALWAYS single-direction only (like Canva), ignore aspect lock
    const calculateResize = (item, handle, deltaX, deltaY, aspectLocked) => {
        let newW = item.width, newH = item.height, newX = item.x, newY = item.y;
        const ratio = item.aspectRatio || (item.width / item.height);

        switch (handle) {
            // Corner handles - respect aspect ratio lock
            case 'se':
                newW = item.width + deltaX;
                newH = aspectLocked ? newW / ratio : item.height + deltaY;
                break;
            case 'sw':
                newW = item.width - deltaX;
                newH = aspectLocked ? newW / ratio : item.height + deltaY;
                newX = item.x + deltaX;
                break;
            case 'ne':
                newW = item.width + deltaX;
                if (aspectLocked) {
                    newH = newW / ratio;
                    newY = item.y - (newH - item.height);
                } else {
                    newH = item.height - deltaY;
                    newY = item.y + deltaY;
                }
                break;
            case 'nw':
                newW = item.width - deltaX;
                if (aspectLocked) {
                    newH = newW / ratio;
                    newY = item.y - (newH - item.height);
                } else {
                    newH = item.height - deltaY;
                    newY = item.y + deltaY;
                }
                newX = item.x + deltaX;
                break;

            // Edge handles - SINGLE DIRECTION ONLY (ignores aspect lock)
            case 'e':
                newW = item.width + deltaX;
                // Do NOT change height - right edge only
                break;
            case 'w':
                newW = item.width - deltaX;
                newX = item.x + deltaX;
                // Do NOT change height - left edge only
                break;
            case 's':
                newH = item.height + deltaY;
                // Do NOT change width - bottom edge only
                break;
            case 'n':
                newH = item.height - deltaY;
                newY = item.y + deltaY;
                // Do NOT change width - top edge only
                break;
        }
        return { x: newX, y: newY, width: Math.max(0.5, newW), height: Math.max(0.5, newH) };
    };

    // Start resizing with a specific handle
    const startResize = (item, handle, e) => {
        e.stopPropagation();
        state.selectedItemId = item.id;
        state.isResizing = true;
        state.resizeHandle = handle;
        const rect = $('#print-sheet')[0].getBoundingClientRect();
        state.resizeStartPos = { x: (e.clientX - rect.left) / state.zoom, y: (e.clientY - rect.top) / state.zoom };
        state.resizeStartSize = { w: item.width, h: item.height };
        state.resizeStartItemPos = { x: item.x, y: item.y };
        $(`[data-item-id="${item.id}"]`).addClass('item-resizing');
    };

    /**
     * LAYOUT ALGORITHM
     */
    const MAX_ITEMS = 200; // Limit to prevent memory issues

    const calculateLayout = (itemList, formatW, formatH) => {
        const groups = {};
        itemList.forEach(item => {
            const key = item.groupId || item.id;
            if (!groups[key]) groups[key] = { ...item };
            else groups[key].quantity = Math.max(groups[key].quantity || 1, item.quantity || 1);
        });

        let itemsToPlace = [];
        let totalCount = 0;
        Object.values(groups).forEach(master => {
            const count = Math.max(1, master.quantity || 1);
            const itemsToAdd = Math.min(count, MAX_ITEMS - totalCount);
            const eff = getEffectiveSize(master);
            for (let i = 0; i < itemsToAdd; i++) {
                itemsToPlace.push({ ...master, id: null, x: 0, y: 0, rawW: eff.width, rawH: eff.height });
            }
            totalCount += itemsToAdd;
            if (totalCount >= MAX_ITEMS) return;
        });

        itemsToPlace.sort((a, b) => Math.max(b.rawW, b.rawH) - Math.max(a.rawW, a.rawH));

        let shelves = [];
        let currentY = 0;
        const placedItems = [];
        let overflowCount = 0;

        itemsToPlace.forEach((item, index) => {
            item.id = `layout-${Date.now()}-${index}`;
            let bestShelfIndex = -1;
            let bestRotation = 0;
            let minWaste = Infinity;

            for (let i = 0; i < shelves.length; i++) {
                const shelf = shelves[i];
                const remainingW = formatW - shelf.currentX;
                if (remainingW >= item.rawW && shelf.height >= item.rawH) {
                    const waste = shelf.height - item.rawH;
                    if (waste < minWaste) { minWaste = waste; bestShelfIndex = i; bestRotation = 0; }
                }
                if (remainingW >= item.rawH && shelf.height >= item.rawW) {
                    const waste = shelf.height - item.rawW;
                    if (waste < minWaste) { minWaste = waste; bestShelfIndex = i; bestRotation = 90; }
                }
            }

            if (bestShelfIndex !== -1) {
                const shelf = shelves[bestShelfIndex];

                // Visual dimensions of the packed item
                const VW = (bestRotation === 0) ? item.rawW : item.rawH;
                const VH = (bestRotation === 0) ? item.rawH : item.rawW;

                // Calculate centered position logic
                // Visual Center = Shelf Current X + VW/2, Shelf Y + VH/2
                // Item Pos = Visual Center - Item Width/2, Visual Center - Item Height/2
                const cssX = shelf.currentX + VW / 2 - item.width / 2;
                const cssY = shelf.y + VH / 2 - item.height / 2;

                placedItems.push({ ...item, x: parseFloat(cssX.toFixed(2)), y: parseFloat(cssY.toFixed(2)), rotation: (item.rotation || 0) + bestRotation });
                shelf.currentX += VW + GAP_CM;
            } else {
                // Logic to determine new shelf size/orientation
                // Prefer keeping current orientation
                let nW, nH, rot;

                if (item.rawW <= formatW) {
                    nW = item.rawW; nH = item.rawH; rot = 0;
                } else if (item.rawH <= formatW) {
                    nW = item.rawH; nH = item.rawW; rot = 90;
                } else {
                    overflowCount++; return;
                }

                if (currentY + nH <= formatH) {
                    const VW = nW;
                    const VH = nH;

                    const cssX = 0 + VW / 2 - item.width / 2;
                    const cssY = currentY + VH / 2 - item.height / 2;

                    placedItems.push({ ...item, x: parseFloat(cssX.toFixed(2)), y: parseFloat(cssY.toFixed(2)), rotation: (item.rotation || 0) + rot });
                    shelves.push({ y: currentY, height: nH, currentX: nW + GAP_CM });
                    currentY += nH + GAP_CM;
                } else {
                    overflowCount++;
                }
            }
        });

        if (overflowCount > 0) {
            const placedCounts = {};
            placedItems.forEach(i => placedCounts[i.groupId] = (placedCounts[i.groupId] || 0) + 1);
            placedItems.forEach(i => { if (placedCounts[i.groupId]) i.quantity = placedCounts[i.groupId]; });
        }
        return { placedItems, overflowCount };
    };

    /**
     * RENDERING LOGIC
     */
    const renderRulers = () => {
        const $rh = $('#ruler-h').empty();
        const $rv = $('#ruler-v').empty();

        // Horizontal
        for (let i = 0; i <= state.selectedFormat.width; i++) {
            if (i % 5 === 0) {
                $rh.append(`<div class="absolute flex flex-col items-center text-[9px] text-slate-500 font-mono" style="left: ${cmToPx(i)}px; top: -24px; width: 1px;"><span class="mb-0.5">${i}</span><div class="bg-slate-400 h-2 w-px"></div></div>`);
            } else {
                $rh.append(`<div class="absolute bg-slate-300" style="left: ${cmToPx(i)}px; bottom: 0; height: 5px; width: 1px;"></div>`);
            }
        }
        // Vertical
        for (let i = 0; i <= state.selectedFormat.height; i++) {
            if (i % 5 === 0) {
                $rv.append(`<div class="absolute flex items-center justify-end text-[9px] text-slate-500 font-mono" style="top: ${cmToPx(i)}px; left: -24px; height: 1px;"><span class="mr-0.5">${i}</span><div class="bg-slate-400 w-2 h-px"></div></div>`);
            } else {
                $rv.append(`<div class="absolute bg-slate-300" style="top: ${cmToPx(i)}px; right: 0; width: 5px; height: 1px;"></div>`);
            }
        }

        $('#canvas-grid').css('background-image', `linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)`)
            .css('background-size', `${cmToPx(1)}px ${cmToPx(1)}px`);
    };

    // Render sheet tabs for switching between sheets
    const renderSheetTabs = () => {
        const $tabs = $('#sheet-tabs').empty();

        // Add tabs for saved sheets
        state.savedSheets.forEach((sheet, index) => {
            const isActive = state.currentSheetIndex === index;
            const itemCount = sheet.items.length;
            const $tab = $(`
                        <div class="sheet-tab flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-all ${isActive ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}" data-sheet-index="${index}">
                            <i data-lucide="file" class="size-4"></i>
                            <span class="font-medium text-sm">Bogen ${index + 1}</span>
                            <span class="text-xs ${isActive ? 'text-blue-200' : 'text-slate-400'}">(${itemCount})</span>
                            <button class="sheet-delete-btn ml-1 p-0.5 rounded hover:bg-red-500 hover:text-white transition" data-delete-index="${index}">
                                <i data-lucide="x" class="size-3"></i>
                            </button>
                        </div>
                    `);
            $tab.on('click', (e) => {
                if ($(e.target).closest('.sheet-delete-btn').length) {
                    e.stopPropagation();
                    // Delete this sheet
                    state.savedSheets.splice(index, 1);
                    if (state.currentSheetIndex === index) {
                        // Switch to new sheet
                        state.currentSheetIndex = null;
                        state.items = [];
                    } else if (state.currentSheetIndex > index) {
                        state.currentSheetIndex--;
                    }
                    updateUI();
                    console.log('Deleted sheet', index+1);
                    $(`.file_input_${index+1}`).remove();
                    return;
                }
                // Switch to this sheet
                switchToSheet(index);
            });
            $tabs.append($tab);
        });

        // Add "New Sheet" tab
        const isNewSheet = state.currentSheetIndex === null;
        const $newTab = $(`
                    <div class="sheet-tab flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-all ${isNewSheet ? 'bg-green-600 text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-2 border-dashed border-slate-300'}">
                        <i data-lucide="${isNewSheet ? 'edit-3' : 'plus'}" class="size-4"></i>
                        <span class="font-medium text-sm">${isNewSheet ? 'Aktueller Bogen' : 'Neuer Bogen'}</span>
                        ${isNewSheet && state.items.length > 0 ? `<span class="text-xs text-green-200">(${state.items.length})</span>` : ''}
                    </div>
                `).on('click', () => {
            guardUnsavedChanges(() => {
                state.currentSheetIndex = null;
                state.items = [];
                state.selectedItemId = null;
                updateUI();
            });
        });
        $tabs.append($newTab);

        // Add spacer to push BESTELLEN button to right
        $tabs.append($('<div class="flex-1"></div>'));

        // Add BESTELLEN button (Order button) - right side
        const $orderBtn = $(`
                        <button id="bestellen-btn" class="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105">
                            <i data-lucide="shopping-bag" class="size-5"></i>
                            <span>BESTELLEN</span>
                        </button>
                    `).on('click', () => openOrderModal());
        $tabs.append($orderBtn);

        const $saveBtn = $(`
                        <button id="save-sheet-btn" class="flex items-center gap-2 px-4 py-2.5 ml-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span class="save-icon"><i data-lucide="save" class="size-5"></i></span>
                            <span class="save-label">Speichern</span>
                        </button>
                    `).on('click', async () => {
            if (!state.items.length && state.currentSheetIndex === null) return;
            const $btn = $('#save-sheet-btn');
            $btn.prop('disabled', true);
            $btn.find('.save-icon').html('<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="4" fill="none" opacity="0.3"/><path d="M12 2 a10 10 0 0 1 10 10" stroke="white" stroke-width="4" fill="none"/></svg>');
            $btn.find('.save-label').text('Speichern…');
            try {
                await saveCurrentSheet();
                showToast('Gespeichert');
            } catch (e) {
                showToast('Speichern fehlgeschlagen', 'error');
            }
            $btn.find('.save-icon').html('<i data-lucide="save" class="size-5"></i>');
            $btn.find('.save-label').text('Speichern');
            $btn.prop('disabled', !isCurrentSheetDirty());
            updateUI();
        });
        $tabs.append($saveBtn);

        // Add Close button (X) - to close canvas
        const $closeBtn = $(`
                        <button id="close-canvas-btn" class="flex items-center justify-center w-10 h-10 ml-3 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 rounded-xl transition-all duration-200" title="Schließen">
                            <i data-lucide="x" class="size-6"></i>
                        </button>
                    `).on('click', () => {
            $('#nw-canvas').fadeOut(200);
        });
        $tabs.append($closeBtn);

        lucide.createIcons();
        $('#save-sheet-btn').prop('disabled', !isCurrentSheetDirty());
    };

    // Switch to a saved sheet for editing
    const switchToSheet = (index) => {
        guardUnsavedChanges(() => {
            state.currentSheetIndex = index;
            const sheet = state.savedSheets[index];
            state.items = [...sheet.items];
            state.selectedFormat = sheet.format;
            state.selectedItemId = null;
            state.originalSheetSnapshot = { items: JSON.parse(JSON.stringify(sheet.items)), format: { ...sheet.format } };
            updateUI();
        });
    };

    // Open the Order Modal with all projects
    const openOrderModal = () => {
        // First save current sheet if it has items
        if (state.currentSheetIndex !== null && state.items.length > 0) {
            state.savedSheets[state.currentSheetIndex].items = [...state.items];
            state.savedSheets[state.currentSheetIndex].format = state.selectedFormat;
        } else if (state.currentSheetIndex === null && state.items.length > 0) {
            state.savedSheets.push({
                id: Date.now(),
                format: state.selectedFormat,
                items: [...state.items],
                price: state.selectedFormat.price
            });
            state.currentSheetIndex = state.savedSheets.length - 1;
        }

        const $grid = $('#order-cards-grid').empty();
        let totalPrice = 0;
        let totalProducts = 0;

        // Render each saved sheet as a card
        state.savedSheets.filter(s => !!s.savedUrl).forEach((sheet, index) => {
            totalProducts++;
            totalPrice += sheet.price || sheet.format.price;

            // Calculate preview dimensions (fit within card while maintaining aspect ratio)
            const sheetW = sheet.format.width;
            const sheetH = sheet.format.height;
            const previewMaxW = 180;
            const previewMaxH = 180;
            const scale = Math.min(previewMaxW / cmToPx(sheetW), previewMaxH / cmToPx(sheetH));
            const previewW = cmToPx(sheetW) * scale;
            const previewH = cmToPx(sheetH) * scale;

            // Generate positioned items for preview
            const previewItemsHtml = sheet.items.map(item => {
                const itemW = cmToPx(item.width) * scale;
                const itemH = cmToPx(item.height) * scale;
                const itemX = cmToPx(item.x) * scale;
                const itemY = cmToPx(item.y) * scale;
                const rotation = item.rotation || 0;
                return `<img src="${item.src}" style="position: absolute; left: ${itemX}px; top: ${itemY}px; width: ${itemW}px; height: ${itemH}px; transform: rotate(${rotation}deg); transform-origin: center; object-fit: contain; pointer-events: none;" />`;
            }).join('');

            const $card = $(`
                            <div class="bg-white rounded-2xl transition-all duration-300 overflow-hidden border border-slate-100 group">
                                <div class="w-full p-4 flex items-center justify-center">
                                    <div class="relative bg-[#e6e6e6] overflow-hidden border border-slate-200 rounded-lg" style="width: ${previewW}px; height: ${previewH}px; max-width: 220px; max-height: 220px; background: #ffffff;">
                                        ${previewItemsHtml || '<div class="absolute inset-0 flex items-center justify-center text-slate-400 text-xs">Leer</div>'}
                                    </div>
                                </div>
                                <div class="p-4 border-t border-slate-100">
                                    <div class="flex items-center justify-between mb-3">
                                        <div class="flex items-center gap-2">
                                            <input type="number" value="1" min="1" class="sheet-qty w-12 text-center border border-slate-200 rounded-lg py-1 text-sm font-semibold" data-index="${index}" />
                                            <span class="text-slate-500 text-sm">St</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <button class="qty-minus p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 transition" data-index="${index}">
                                                <i data-lucide="minus" class="size-4 text-slate-600"></i>
                                            </button>
                                            <button class="qty-plus p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 transition" data-index="${index}">
                                                <i data-lucide="plus" class="size-4 text-slate-600"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="flex flex-col gap-2 text-xs text-slate-600 mb-3">
                                        <div class="flex flex-col gap-0.5">
                                            <span>Format:</span>
                                            <span class="text-blue-600 font-medium">${sheet.options?.formatName || sheet.format.width + ' x ' + sheet.format.height + ' cm'}</span>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <span>Breite:</span>
                                            <span class="text-blue-600 font-medium">${sheet.format.width} cm</span>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <span>Höhe:</span>
                                            <span class="text-blue-600 font-medium">${sheet.format.height} cm</span>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <span>Elemente < 1mm drucken:</span>
                                            <span class="text-blue-600 font-medium">${(sheet.options?.printSmallElements ?? true) ? 'Ja' : 'Nein'}</span>
                                        </div>
                                    </div>
                                    <div class="flex items-center flex-wrap gap-2">
                                        <button class="edit-sheet-btn flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1" data-index="${index}">
                                            Projekt<br/>bearbeiten
                                        </button>
                                        <button class="delete-sheet-btn p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition flex items-center gap-1" data-index="${index}">
                                            <i data-lucide="trash-2" class="size-4"></i>
                                            <span class="text-xs">Löschen</span>
                                        </button>
                                        <button class="duplicate-sheet-btn p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition flex items-center gap-1" data-index="${index}">
                                            <i data-lucide="copy" class="size-4"></i>
                                            <span class="text-xs">Duplizieren</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `);

            $card.find('.edit-sheet-btn').on('click', () => {
                $('#order-modal').addClass('hidden');
                switchToSheet(index);
            });

            // Delete sheet handler
            $card.find('.delete-sheet-btn').on('click', () => {
                const realIndex = state.savedSheets.indexOf(sheet);
                if (realIndex > -1) {
                    state.savedSheets.splice(realIndex, 1);
                    if (state.currentSheetIndex === realIndex) {
                        state.currentSheetIndex = null;
                        state.items = [];
                    } else if (state.currentSheetIndex > realIndex) {
                        state.currentSheetIndex--;
                    }
                    openOrderModal(); // Refresh modal
                    updateUI();
                }
            });

            // Duplicate sheet handler
            $card.find('.duplicate-sheet-btn').on('click', () => {
                const duplicate = {
                    id: Date.now(),
                    format: { ...sheet.format },
                    items: sheet.items.map(i => ({ ...i, id: Date.now() + Math.random() })),
                    price: sheet.price || sheet.format.price,
                    savedUrl: sheet.savedUrl,
                    savedFileName: sheet.savedFileName,
                    lastSavedHash: sheet.lastSavedHash,
                    options: sheet.options ? { ...sheet.options } : undefined
                };
                state.savedSheets.push(duplicate);
                openOrderModal(); // Refresh modal
                updateUI();
            });

            // Quantity +/- handlers
            $card.find('.qty-plus').on('click', () => {
                const $input = $card.find('.sheet-qty');
                $input.val(parseInt($input.val()) + 1);
            });

            $card.find('.qty-minus').on('click', () => {
                const $input = $card.find('.sheet-qty');
                const val = parseInt($input.val());
                if (val > 1) $input.val(val - 1);
            });

            $grid.append($card);
        });

        // Add "New Project" card
        const $newCard = $(`
                        <div class="bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border-2 border-dashed border-slate-300 hover:border-blue-400 group cursor-pointer flex flex-col items-center justify-center min-h-[300px]">
                            <div class="w-16 h-16 rounded-full bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center mb-4 transition">
                                <i data-lucide="plus" class="size-8 text-blue-600"></i>
                            </div>
                            <span class="font-semibold text-slate-600 group-hover:text-blue-600 transition">Neues Projekt hinzufügen</span>
                        </div>
                    `).on('click', () => {
            $('#order-modal').addClass('hidden');
            state.currentSheetIndex = null;
            state.items = [];
            state.selectedItemId = null;
            updateUI();
        });
        $grid.append($newCard);

        // Update footer totals
        $('#order-product-count').text(totalProducts);
        $('#order-total-price').text(`€${totalPrice.toFixed(2)}`);

        // Show modal
        $('#order-modal').removeClass('hidden');
        lucide.createIcons();
    };

    // Close order modal handlers
    $(document).on('click', '#close-order-modal, #order-modal-backdrop', () => {
        $('#order-modal').addClass('hidden');
    });

    $(document).on('keydown', (e) => {
        if (e.key === 'Escape' && !$('#order-modal').hasClass('hidden')) {
            $('#order-modal').addClass('hidden');
        }
    });
    $(document).on('click', '#unsaved-cancel, #unsaved-modal-backdrop', () => {
        closeUnsavedModal();
    });
    $(document).on('click', '#unsaved-discard', () => {
        if (state.currentSheetIndex !== null && state.originalSheetSnapshot) {
            state.items = JSON.parse(JSON.stringify(state.originalSheetSnapshot.items));
            state.selectedFormat = { ...state.originalSheetSnapshot.format };
        } else {
            state.items = [];
        }
        const next = pendingGuardNext; closeUnsavedModal(); if (next) next();
    });
    $(document).on('click', '#unsaved-save', async () => {
        const $btn = $('#unsaved-save');
        const originalText = $btn.html();
        $btn.prop('disabled', true).html('<i data-lucide="loader-2" class="size-4 animate-spin"></i> Speichert...');
        lucide.createIcons();
        try {
            await saveCurrentSheet();
            showToast('Gespeichert');
        } catch (_) {
            showToast('Speichern fehlgeschlagen', 'error');
        } finally {
            $btn.prop('disabled', false).html(originalText);
        }
        const next = pendingGuardNext; closeUnsavedModal(); if (next) next();
    });

    // Auto-scale to fit artboard in viewport with padding
    const autoScale = () => {
        const $viewport = $('#pan-viewport');
        if (!$viewport.length) return;
        const viewportW = $viewport.width();
        const viewportH = $viewport.height();
        const sheetW = cmToPx(state.selectedFormat.width);
        const sheetH = cmToPx(state.selectedFormat.height);
        const padding = 100; // pixels of padding around the sheet
        // Calculate zoom to fit
        const scaleX = (viewportW - padding * 2) / sheetW;
        const scaleY = (viewportH - padding * 2) / sheetH;
        state.zoom = Math.min(scaleX, scaleY, 1); // Don't zoom above 100%
        state.zoom = Math.max(0.1, Math.min(5, state.zoom)); // Clamp to valid range
        centerCanvas();
    };

    // Center canvas within viewport (Figma-style)
    const centerCanvas = () => {
        const $viewport = $('#pan-viewport');
        if (!$viewport.length) return;
        const viewportW = $viewport.width();
        const viewportH = $viewport.height();
        const sheetW = cmToPx(state.selectedFormat.width) * state.zoom;
        const sheetH = cmToPx(state.selectedFormat.height) * state.zoom;
        // Center the canvas in the viewport
        state.panX = (viewportW - sheetW) / 2;
        state.panY = (viewportH - sheetH) / 2;
    };

    const updateUI = () => {
        // Render sheet tabs
        renderSheetTabs();

        // Apply pan and zoom transforms
        $('#pan-layer').css('transform', `translate(${state.panX}px, ${state.panY}px)`);
        $('#canvas-wrapper').css('transform', `scale(${state.zoom})`);

        // Labels
        $('#dim-w-label').text(state.selectedFormat.width);
        $('#dim-h-label').text(state.selectedFormat.height);
        $('#zoom-label').text(`${Math.round(state.zoom * 100)}%`);
        $('#print-sheet').css({ width: cmToPx(state.selectedFormat.width), height: cmToPx(state.selectedFormat.height) });

        // Format buttons
        $('#format-options').empty();
        FORMATS.forEach(f => {
            const isActive = f.id === state.selectedFormat.id;
            const $btn = $(`
            <button class="w-full text-left px-4 py-3 rounded-lg border transition-all flex justify-between items-center ${isActive ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold ring-1 ring-blue-600' : 'bg-[#C2C5CC] border-gray-200 text-slate-700 hover:border-blue-300 hover:brightness-95'}">
                <span>${f.name}</span>
                ${isActive ? '<div class="w-2 h-2 rounded-full bg-blue-600"></div>' : ''}
            </button>
        `).on('click', () => { state.selectedFormat = f; autoScale(); updateUI(); });
            $('#format-options').append($btn);
        });

        // Gallery
        const uniqueUploads = state.items.reduce((acc, current) => {
            if (!acc.find(i => i.groupId === current.groupId)) acc.push(current);
            return acc;
        }, []);

        if (uniqueUploads.length > 0) {
            $('#gallery-container').removeClass('hidden');
            $('#upload-label').text('Weitere Datei hinzufügen');
            $('#item-gallery').empty();
            uniqueUploads.forEach(u => {
                const isActive = state.items.find(i => i.id === state.selectedItemId)?.groupId === u.groupId;
                const $thumb = $(`
                <div class="w-12 h-12 rounded border cursor-pointer overflow-hidden relative ${isActive ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300'}">
                    ${u.isPreviewable ? `<img src="${u.src}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-slate-100 flex items-center justify-center"><i data-lucide="file-text" class="size-4 text-slate-400"></i></div>`}
                    <div class="absolute bottom-0 right-0 bg-slate-800 text-white text-[8px] px-1 font-bold">${u.quantity}</div>
                </div>
            `).on('click', () => {
                    const found = state.items.find(i => i.groupId === u.groupId);
                    if (found) { state.selectedItemId = found.id; updateUI(); }
                });
                $('#item-gallery').append($thumb);
            });
        } else {
            $('#gallery-container').addClass('hidden');
            $('#upload-label').text('Datei hinzufügen');
        }

        // Editor
        const activeItem = state.items.find(i => i.id === state.selectedItemId);
        if (activeItem) {
            $('#item-editor').removeClass('hidden');
            $('#active-item-name span').text(activeItem.name);
            $('#input-qty').val(activeItem.quantity);
            $('#input-width').val(activeItem.width.toFixed(2));
            $('#input-height').val(activeItem.height.toFixed(2));
            $('#btn-fill-page').toggle(uniqueUploads.length === 1);
            // Update aspect lock button
            const $lockBtn = $('#toggle-aspect-lock');
            if (state.aspectRatioLocked) {
                $lockBtn.html('<i data-lucide="lock" class="size-3"></i><span id="aspect-lock-label">Gesperrt</span>')
                    .removeClass('bg-slate-50 border-slate-300 text-slate-600')
                    .addClass('bg-blue-50 border-blue-300 text-blue-700');
            } else {
                $lockBtn.html('<i data-lucide="unlock" class="size-3"></i><span id="aspect-lock-label">Frei</span>')
                    .removeClass('bg-blue-50 border-blue-300 text-blue-700')
                    .addClass('bg-slate-50 border-slate-300 text-slate-600');
            }
        } else {
            $('#item-editor').addClass('hidden');
        }

        // Collisions
        const ids = new Set();
        const rects = state.items.map(item => {
            const isRotated = item.rotation % 180 !== 0;
            let x = item.x, y = item.y, w = item.width, h = item.height;
            if (isRotated) {
                x = item.x + (item.width - item.height) / 2;
                y = item.y + (item.height - item.width) / 2;
                w = item.height; h = item.width;
            }
            return { id: item.id, x, y, w, h };
        });
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const r1 = rects[i], r2 = rects[j];
                const overlap = !(r2.x >= r1.x + r1.w - 0.01 || r2.x + r2.w <= r1.x + 0.01 || r2.y >= r1.y + r1.h - 0.01 || r2.y + r2.h <= r1.y + 0.01);
                if (overlap) { ids.add(r1.id); ids.add(r2.id); }
            }
        }
        state.collidingIds = Array.from(ids);
        $('#collision-warning').toggle(state.collidingIds.length > 0);
        $('#btn-checkout').prop('disabled', state.collidingIds.length > 0);

        // Canvas Items
        $('#items-layer').empty();
        state.items.forEach(item => {
            const isSelected = item.id === state.selectedItemId;
            const isColliding = state.collidingIds.includes(item.id);
            const isDragOrResize = (state.isDragging || state.isResizing) && isSelected;
            const $el = $(`
            <div class="canvas-item absolute cursor-move select-none flex items-center justify-center ${isSelected ? 'item-active' : ''} ${isColliding ? 'item-collision' : ''} ${isDragOrResize ? (state.isDragging ? 'item-dragging' : 'item-resizing') : ''}" 
                 data-item-id="${item.id}"
                 style="left: ${cmToPx(item.x)}px; top: ${cmToPx(item.y)}px; width: ${cmToPx(item.width)}px; height: ${cmToPx(item.height)}px; transform: rotate(${item.rotation}deg); z-index: ${isSelected ? 10 : 1};">
                ${item.isPreviewable ? `<img src="${item.src}" class="w-full h-full object-cover pointer-events-none" draggable="false">` : `
                    <div class="w-full h-full bg-slate-200 border-2 border-slate-300 flex flex-col items-center justify-center p-2 text-center pointer-events-none overflow-hidden">
                        <i data-lucide="file-text" class="text-slate-400 mb-1"></i>
                        <span class="text-[10px] text-slate-600 font-mono break-all leading-tight">${item.name}</span>
                    </div>`}
                ${isSelected && !isColliding ? `
                    <div class="absolute -top-7 left-0 bg-indigo-600 text-white text-[11px] font-bold px-2 py-1 rounded shadow whitespace-nowrap z-20" style="transform: rotate(${-item.rotation}deg)">
                        ${(item.rotation % 180 !== 0 ? item.height : item.width).toFixed(2)} x ${(item.rotation % 180 !== 0 ? item.width : item.height).toFixed(2)} cm
                    </div>` : ''}
                ${isColliding ? `<div class="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl-sm"><i data-lucide="alert-triangle" class="size-2"></i></div>` : ''}
                ${isSelected ? createResizeHandles() : ''}
                ${isSelected ? `
                    <button class="auto-fill-btn absolute -bottom-12 left-1/2 transform -translate-x-1/2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 whitespace-nowrap z-30 transition-all hover:scale-105" style="transform: translateX(-50%) rotate(${-item.rotation}deg)">
                        <i data-lucide="grid-3x3" class="size-3"></i>
                        Automatisch ausfüllen
                    </button>` : ''}
            </div>
        `).on('mousedown', (e) => {
                // Check if clicking on auto-fill button
                if ($(e.target).closest('.auto-fill-btn').length) {
                    e.stopPropagation();
                    // Trigger fill page logic (same as sidebar button)
                    const w = item.width, h = item.height;
                    const sW = state.selectedFormat.width, sH = state.selectedFormat.height;
                    const calc = (iw, ih) => Math.floor((sW + GAP_CM) / (iw + GAP_CM)) * Math.floor((sH + GAP_CM) / (ih + GAP_CM));
                    const best = Math.max(calc(w, h), calc(h, w));
                    if (best === 0) alert("Motiv zu groß!");
                    else updateQuantity(best);
                    return;
                }
                // Check if clicking on handle
                if ($(e.target).hasClass('item-handle')) {
                    const handle = $(e.target).data('handle');
                    if (handle === 'rotate') {
                        rotateBy90(item, e);
                    } else {
                        startResize(item, handle, e);
                    }
                    return;
                }
                // Regular drag
                e.stopPropagation();
                state.selectedItemId = item.id;
                state.isDragging = true;
                const rect = $('#print-sheet')[0].getBoundingClientRect();
                const mouseX = (e.clientX - rect.left) / state.zoom;
                const mouseY = (e.clientY - rect.top) / state.zoom;
                state.dragOffset = { x: mouseX - cmToPx(item.x), y: mouseY - cmToPx(item.y) };
                $el.addClass('item-dragging');
                updateUI();
            });
            $('#items-layer').append($el);
        });

        // Prices
        const currentSheetCount = state.items.length > 0 ? 1 : 0;
        const totalSheets = state.savedSheets.length + currentSheetCount;
        const totalPrice = (state.savedSheets.reduce((sum, s) => sum + s.price, 0) + (currentSheetCount ? state.selectedFormat.price : 0)).toFixed(2);
        $('#sheet-count-label').text(`${totalSheets} Bogen konfiguriert`);
        $('#total-price-label').text(`€${totalPrice}`);

        renderRulers();
        lucide.createIcons();
    };

    /**
     * ACTIONS
     */
    const updateQuantity = (val) => {
        const qty = parseInt(val, 10);
        if (isNaN(qty) || qty < 1) return;
        const activeItem = state.items.find(i => i.id === state.selectedItemId);
        if (!activeItem) return;

        const updated = state.items.map(item => item.groupId === activeItem.groupId ? { ...item, quantity: qty } : item);
        const { placedItems, overflowCount } = calculateLayout(updated, state.selectedFormat.width, state.selectedFormat.height);

        if (overflowCount > 0) {
            $('#editor-warning').text("Kein Platz mehr auf dem Bogen!").show();
        } else {
            $('#editor-warning').hide();
        }

        state.items = placedItems;
        const newSel = state.items.find(i => i.groupId === activeItem.groupId);
        if (newSel) state.selectedItemId = newSel.id;
        updateUI();
    };

    const updateItemSize = (dim, value) => {
        const val = parseFloat(value);
        if (isNaN(val) || val <= 0) return;
        const activeItem = state.items.find(i => i.id === state.selectedItemId);
        if (!activeItem) return;

        let newW, newH;
        if (state.aspectRatioLocked) {
            newW = dim === 'width' ? val : val * activeItem.aspectRatio;
            newH = dim === 'height' ? val : val / activeItem.aspectRatio;
        } else {
            newW = dim === 'width' ? val : activeItem.width;
            newH = dim === 'height' ? val : activeItem.height;
        }

        // Manual mode: directly update with boundary constraints
        if (state.manualMode) {
            const constrained = constrainToBounds(activeItem, activeItem.x, activeItem.y, newW, newH);
            state.items = state.items.map(item => item.id === activeItem.id ? { ...item, ...constrained } : item);
            $('#editor-warning').hide();
        } else {
            const updated = state.items.map(item => item.groupId === activeItem.groupId ? { ...item, width: newW, height: newH } : item);
            const { placedItems, overflowCount } = calculateLayout(updated, state.selectedFormat.width, state.selectedFormat.height);
            state.items = placedItems;
            if (overflowCount > 0) $('#editor-warning').text("Durch Größenänderung passen weniger Motive!").show();
            else $('#editor-warning').hide();
        }

        const newSel = state.items.find(i => i.groupId === activeItem.groupId);
        if (newSel) state.selectedItemId = newSel.id;
        updateUI();
    };

    /**
     * EVENT HANDLERS
     */
    $(() => {
        autoScale();
        updateUI();

        $('#zoom-in').on('click', () => { state.zoom = Math.min(2, state.zoom + 0.1); updateUI(); });
        $('#zoom-out').on('click', () => { state.zoom = Math.max(0.1, state.zoom - 0.1); updateUI(); });

        $('#reset-all').on('click', () => {
            if (confirm('Alles löschen?')) { state.items = []; state.savedSheets = []; state.selectedItemId = null; updateUI(); }
        });

        $('#btn-print-small-yes').on('click', function () {
            state.printSmallElements = true;
            $(this).addClass('bg-blue-600 text-white border-blue-600').removeClass('bg-white text-slate-600 border-slate-200');
            $('#btn-print-small-no').removeClass('bg-blue-600 text-white border-blue-600').addClass('bg-white text-slate-600 border-slate-200');
        });

        $('#btn-print-small-no').on('click', function () {
            state.printSmallElements = false;
            $(this).addClass('bg-blue-600 text-white border-blue-600').removeClass('bg-white text-slate-600 border-slate-200');
            $('#btn-print-small-yes').removeClass('bg-blue-600 text-white border-blue-600').addClass('bg-white text-slate-600 border-slate-200');
        });

        $('#file-input').on('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            const newUploadedItems = [];

            // Show loading
            $('#upload-label').text('Verarbeite...');

            for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                const file = files[fileIndex];
                const ext = file.name.split('.').pop().toLowerCase();
                const isImage = ['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext);
                let detectedDpi = isImage ? await detectImageDPI(file) : null;
                const finalDpi = detectedDpi || FALLBACK_DPI;
                const groupId = generateId('grp');
                const baseItem = { id: generateId('upload'), groupId, name: file.name, type: ext, x: 0, y: 0, rotation: 0, originalDpi: finalDpi, detected: !!detectedDpi, quantity: 1 };

                if (isImage) {
                    // Use compression for large images
                    const compressed = await compressImage(file);
                    if (!compressed) continue;

                    const img = new Image();
                    await new Promise(resolve => {
                        img.onload = () => {
                            const wCm = (compressed.width / finalDpi) * 2.54;
                            const hCm = (compressed.height / finalDpi) * 2.54;
                            const aspectRatio = compressed.width / compressed.height;

                            // Auto-fit: scale image to fit within canvas (80% max, contain mode)
                            const maxW = state.selectedFormat.width * 0.8;
                            const maxH = state.selectedFormat.height * 0.8;
                            let fitW = wCm, fitH = hCm;
                            if (fitW > maxW || fitH > maxH) {
                                const scale = Math.min(maxW / fitW, maxH / fitH);
                                fitW = fitW * scale;
                                fitH = fitH * scale;
                            }
                            // Center the image on the canvas
                            const startX = (state.selectedFormat.width - fitW) / 2;
                            const startY = (state.selectedFormat.height - fitH) / 2;

                            newUploadedItems.push({
                                ...baseItem,
                                src: compressed.dataUrl,
                                originalWidth: wCm,
                                originalHeight: hCm,
                                width: fitW,
                                height: fitH,
                                x: startX,
                                y: startY,
                                aspectRatio,
                                isPreviewable: true
                            });
                            resolve();
                        };
                        img.onerror = () => resolve();
                        img.src = compressed.dataUrl;
                    });

                    // Update progress
                    $('#upload-label').text(`${fileIndex + 1}/${files.length} verarbeitet...`);
                } else {
                    newUploadedItems.push({ ...baseItem, src: null, width: 21.0, height: 29.7, originalWidth: 21.0, originalHeight: 29.7, aspectRatio: 21.0 / 29.7, isPreviewable: false });
                }
            }

            // Reset upload label
            $('#upload-label').text('Datei hinzufügen');

            // Skip auto-layout in manual mode - use pre-calculated positions
            if (state.manualMode) {
                const placed = newUploadedItems.map((it, idx) => ({ ...it, id: generateId('item') }));
                state.items = [...state.items, ...placed];
            } else {
                const currentCount = state.items.length;
                const placed = newUploadedItems.map((it, idx) => ({ ...it, id: generateId('item'), x: (currentCount + idx) * 0.5, y: (currentCount + idx) * 0.5 }));
                const { placedItems, overflowCount } = calculateLayout([...state.items, ...placed], state.selectedFormat.width, state.selectedFormat.height);
                if (overflowCount > 0) alert(`${overflowCount} Datei(en) passten nicht mehr auf den Bogen.`);
                state.items = placedItems;
            }

            if (newUploadedItems.length) {
                const lastGrp = newUploadedItems[newUploadedItems.length - 1].groupId;
                state.selectedItemId = state.items.find(i => i.groupId === lastGrp)?.id;
            }
            e.target.value = '';
            updateUI();
        });

        $('#input-qty').on('input', e => updateQuantity(e.target.value));
        $('#input-width').on('input', e => updateItemSize('width', e.target.value));
        $('#input-height').on('input', e => updateItemSize('height', e.target.value));

        $('#btn-rotate').on('click', () => {
            const active = state.items.find(i => i.id === state.selectedItemId);
            if (!active) return;
            const newRotation = (active.rotation + 90) % 360;

            if (state.manualMode) {
                // Manual mode: rotate in place, adjust position to keep center
                const willBeRotated = newRotation % 180 !== 0;
                const wasRotated = active.rotation % 180 !== 0;
                let newX = active.x, newY = active.y;
                if (willBeRotated !== wasRotated) {
                    const centerX = active.x + active.width / 2;
                    const centerY = active.y + active.height / 2;
                    newX = centerX - active.height / 2;
                    newY = centerY - active.width / 2;
                }
                const constrained = constrainToBounds(active, newX, newY, active.width, active.height);
                state.items = state.items.map(i => i.id === active.id ? { ...i, rotation: newRotation, x: constrained.x, y: constrained.y } : i);
            } else {
                const updated = state.items.map(i => i.groupId === active.groupId ? { ...i, rotation: newRotation } : i);
                const { placedItems } = calculateLayout(updated, state.selectedFormat.width, state.selectedFormat.height);
                state.items = placedItems;
            }
            state.selectedItemId = state.items.find(i => i.groupId === active.groupId)?.id;
            updateUI();
        });

        $('#btn-delete').on('click', () => {
            const active = state.items.find(i => i.id === state.selectedItemId);
            if (!active) return;
            const remaining = state.items.filter(i => i.groupId !== active.groupId);
            const { placedItems } = calculateLayout(remaining, state.selectedFormat.width, state.selectedFormat.height);
            state.items = placedItems;
            state.selectedItemId = null;
            updateUI();
        });

        $('#btn-reset-size').on('click', () => {
            const active = state.items.find(i => i.id === state.selectedItemId);
            if (!active) return;
            const updated = state.items.map(i => i.groupId === active.groupId ? { ...i, width: i.originalWidth, height: i.originalHeight } : i);
            const { placedItems } = calculateLayout(updated, state.selectedFormat.width, state.selectedFormat.height);
            state.items = placedItems;
            state.selectedItemId = state.items.find(i => i.groupId === active.groupId)?.id;
            updateUI();
        });

        $('#btn-fill-page').on('click', () => {
            const active = state.items.find(i => i.id === state.selectedItemId);
            if (!active) return;
            const w = active.width, h = active.height;
            const sW = state.selectedFormat.width, sH = state.selectedFormat.height;
            const calc = (iw, ih) => Math.floor((sW + GAP_CM) / (iw + GAP_CM)) * Math.floor((sH + GAP_CM) / (ih + GAP_CM));
            const best = Math.max(calc(w, h), calc(h, w));
            if (best === 0) alert("Motiv zu groß!");
            else updateQuantity(best);
        });

        $('#btn-add-sheet').on('click', () => {
            if (state.collidingIds.length) { showToast('Überlappungen beheben!', 'error'); return; }
            guardUnsavedChanges(() => {
                state.currentSheetIndex = null;
                state.items = [];
                state.selectedItemId = null;
                updateUI();
            });
        });

        $('#btn-checkout').on('click', () => {
            // Save current sheet if has items
            if (state.items.length > 0) {
                if (state.currentSheetIndex !== null) {
                    state.savedSheets[state.currentSheetIndex].items = [...state.items];
                } else {
                    state.savedSheets.push({ id: Date.now(), format: state.selectedFormat, items: [...state.items], price: state.selectedFormat.price });
                    state.items = [];
                    state.currentSheetIndex = null;
                }
            }

            if (!state.savedSheets.length) return alert("Keine Motive.");

            // Show order modal
            const $container = $('#order-sheets-container').empty();
            let total = 0;

            state.savedSheets.forEach((sheet, index) => {
                total += sheet.price;
                const itemCount = sheet.items.length;
                const $preview = $(`
                            <div class="border border-slate-200 rounded-xl p-4 mb-4 bg-white">
                                <div class="flex justify-between items-center mb-3">
                                    <h3 class="font-bold text-slate-800">Bogen ${index + 1}</h3>
                                    <div class="flex items-center gap-3">
                                        <span class="text-sm text-slate-500">${sheet.format.name}</span>
                                        <span class="font-bold text-green-600">€${sheet.price.toFixed(2)}</span>
                                    </div>
                                </div>
                                <div class="flex flex-wrap gap-2">
                                    ${sheet.items.slice(0, 5).map(item => `
                                        <div class="w-16 h-16 bg-slate-100 rounded border border-slate-200 overflow-hidden flex items-center justify-center">
                                            ${item.isPreviewable ? `<img src="${item.src}" class="w-full h-full object-cover">` : `<i data-lucide="file" class="size-6 text-slate-400"></i>`}
                                        </div>
                                    `).join('')}
                                    ${itemCount > 5 ? `<div class="w-16 h-16 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-500 font-bold">+${itemCount - 5}</div>` : ''}
                                </div>
                                <p class="text-sm text-slate-500 mt-2">${itemCount} Motive</p>
                            </div>
                        `);
                $container.append($preview);
            });

            $('#order-total-price').text(`€${total.toFixed(2)}`);
            $('#order-modal').removeClass('hidden');
            lucide.createIcons();
            updateUI();
        });

        $('#close-order-modal').on('click', () => {
            $('#order-modal').addClass('hidden');
        });

        $('#btn-add-to-cart').on('click', async () => {
            const saved = state.savedSheets.filter(s => !!s.savedUrl);
            if (!saved.length) { showToast('Keine gespeicherten Bögen', 'info'); return; }

            // Find the main product form
            const $mainForm = $('.shopify-product-form, form[action="/cart/add"]');
            if (!$mainForm.length) { showToast('Produktformular nicht gefunden', 'error'); return; }

            const variantId = $mainForm.find('input[name="id"]').val();
            if (!variantId) { showToast('Produkt ID fehlt', 'error'); return; }

            // Clear existing hidden property inputs to avoid duplication
            $mainForm.find('input[name^="properties[Frame"]').remove();
            console.log(saved)
            // Add properties to the form
            saved.forEach((sheet, idx) => {
                // $mainForm.append(`<input type="hidden" name="properties[_Frame_${idx + 1}_Url]" value="${sheet.savedUrl}">`);
                // $mainForm.append(`<input type="hidden" name="properties[_Frame_${idx + 1}_Name]" value="${sheet.savedFileName || ''}">`);
                // $mainForm.append(`<input type="hidden" name="properties[Frame ${idx + 1} Width]" value="${sheet.format.width}">`);
                // $mainForm.append(`<input type="hidden" name="properties[Frame ${idx + 1} Height]" value="${sheet.format.height}">`);
                // $mainForm.append(`<input type="hidden" name="properties[Frame ${idx + 1} Format]" value="${sheet.options?.formatName || ''}">`);
                $mainForm.append(`<input type="hidden" class="file_input_${idx + 1}" name="properties[Print_Type_${idx + 1}]" value="${(sheet.options?.printSmallElements ?? true) ? 'Ja' : 'Nein'}">`);
            });

            // Update quantity
            const $qtyInput = $mainForm.find('input[name="quantity"]');
            if ($qtyInput.length) {
                $qtyInput.val(saved.length);
            } else {
                $mainForm.append(`<input type="hidden" name="quantity" value="${saved.length}">`);
            }

            // Close modal and designer
            $('#order-modal').addClass('hidden');
            $('#nw-canvas').fadeOut(200);

            // Trigger the main add to cart button
            const $submitBtn = $mainForm.find('[type="submit"], [name="add"], .product-form__submit, .add-to-cart-btn').first();
            if ($submitBtn.length) {
                $submitBtn.click();
            } else {
                $mainForm.submit();
            }

            // Reset state
            state.savedSheets = [];
            state.items = [];
            state.currentSheetIndex = null;
            state.selectedItemId = null;
            updateUI();
        });

        $(window).on('mousemove', (e) => {
            if (!state.selectedItemId) return;

            // Handle dragging
            if (state.isDragging) {
                throttledUpdate(() => {
                    const rect = $('#print-sheet')[0].getBoundingClientRect();
                    const mouseX = (e.clientX - rect.left) / state.zoom;
                    const mouseY = (e.clientY - rect.top) / state.zoom;
                    let nX = pxToCm(mouseX - state.dragOffset.x);
                    let nY = pxToCm(mouseY - state.dragOffset.y);
                    const active = state.items.find(i => i.id === state.selectedItemId);
                    if (!active) return;

                    // Allow free movement outside canvas (Canva-like behavior)
                    // Canvas clips content that extends beyond bounds
                    state.items = state.items.map(i => i.id === state.selectedItemId ? { ...i, x: nX, y: nY } : i);
                    updateUI();
                });
            }

            // Handle resizing
            if (state.isResizing) {
                throttledUpdate(() => {
                    const rect = $('#print-sheet')[0].getBoundingClientRect();
                    const mouseX = (e.clientX - rect.left) / state.zoom;
                    const mouseY = (e.clientY - rect.top) / state.zoom;
                    const deltaX = pxToCm(mouseX - state.resizeStartPos.x);
                    const deltaY = pxToCm(mouseY - state.resizeStartPos.y);
                    const active = state.items.find(i => i.id === state.selectedItemId);
                    if (!active) return;
                    const resized = calculateResize(
                        { ...active, width: state.resizeStartSize.w, height: state.resizeStartSize.h, x: state.resizeStartItemPos.x, y: state.resizeStartItemPos.y },
                        state.resizeHandle, deltaX, deltaY, state.aspectRatioLocked
                    );
                    // Allow free resize outside canvas (Canva-like behavior)
                    state.items = state.items.map(i => i.id === state.selectedItemId ? { ...i, ...resized } : i);
                    updateUI();
                });
            }
            // Note: Rotation is now click-based (90° increments), no drag rotation
        }).on('mouseup', () => {
            if (state.isDragging) $('.item-dragging').removeClass('item-dragging');
            if (state.isResizing) $('.item-resizing').removeClass('item-resizing');
            state.isDragging = false;
            state.isResizing = false;
            state.resizeHandle = null;
        });

        $('#print-sheet').on('click', () => { state.selectedItemId = null; updateUI(); });

        // ===== FIGMA-STYLE PAN & ZOOM =====

        // Mouse wheel zoom (cursor-relative, works without Ctrl like Figma)
        $('#pan-viewport').on('wheel', (e) => {
            e.preventDefault();
            const $viewport = $('#pan-viewport');
            const rect = $viewport[0].getBoundingClientRect();
            const mouseX = e.originalEvent.clientX - rect.left;
            const mouseY = e.originalEvent.clientY - rect.top;

            const oldZoom = state.zoom;
            // Figma uses scroll for zoom
            const zoomDelta = e.originalEvent.deltaY > 0 ? -0.1 : 0.1;
            const newZoom = Math.max(0.1, Math.min(5, state.zoom + zoomDelta));

            if (newZoom !== oldZoom) {
                // Calculate the point in canvas space that's under the mouse
                const canvasX = (mouseX - state.panX) / oldZoom;
                const canvasY = (mouseY - state.panY) / oldZoom;

                // Apply new zoom
                state.zoom = newZoom;

                // Adjust pan so the same canvas point stays under the mouse
                state.panX = mouseX - canvasX * newZoom;
                state.panY = mouseY - canvasY * newZoom;

                updateUI();
            }
        });

        // Pan with mouse drag (hand tool)
        $('#pan-viewport').on('mousedown', (e) => {
            // Only pan if clicking on empty space, not on items or handles
            const $target = $(e.target);
            if ($target.closest('#items-layer').length &&
                ($target.closest('.canvas-item').length || $target.closest('.item-handle').length)) {
                return; // Let item interaction handle this
            }

            // Start panning
            state.isPanning = true;
            state.panStartX = e.clientX;
            state.panStartY = e.clientY;
            state.panStartPanX = state.panX;
            state.panStartPanY = state.panY;
            $('#pan-viewport').css('cursor', 'grabbing');
            e.preventDefault();
        });

        $(window).on('mousemove.pan', (e) => {
            if (state.isPanning) {
                const dx = e.clientX - state.panStartX;
                const dy = e.clientY - state.panStartY;
                state.panX = state.panStartPanX + dx;
                state.panY = state.panStartPanY + dy;
                $('#pan-layer').css('transform', `translate(${state.panX}px, ${state.panY}px)`);
            }
        });

        $(window).on('mouseup.pan', () => {
            if (state.isPanning) {
                state.isPanning = false;
                $('#pan-viewport').css('cursor', 'grab');
            }
        });

        // Aspect ratio lock toggle
        $(document).on('click', '#toggle-aspect-lock', () => {
            state.aspectRatioLocked = !state.aspectRatioLocked;
            updateUI();
        });

        // Keyboard shortcuts
        $(document).on('keydown', (e) => {
            if (!state.selectedItemId) return;
            const active = state.items.find(i => i.id === state.selectedItemId);
            if (!active) return;
            // Delete key
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                state.items = state.items.filter(i => i.groupId !== active.groupId);
                state.selectedItemId = null;
                updateUI();
                return;
            }
            // Arrow keys for nudging
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const nudge = e.shiftKey ? 0.1 : 1.0;
                let newX = active.x, newY = active.y;
                if (e.key === 'ArrowLeft') newX -= nudge;
                if (e.key === 'ArrowRight') newX += nudge;
                if (e.key === 'ArrowUp') newY -= nudge;
                if (e.key === 'ArrowDown') newY += nudge;
                const { width: ew, height: eh } = getEffectiveSize(active);
                newX = Math.max(0, Math.min(newX, state.selectedFormat.width - ew));
                newY = Math.max(0, Math.min(newY, state.selectedFormat.height - eh));
                state.items = state.items.map(i => i.id === state.selectedItemId ? { ...i, x: newX, y: newY } : i);
                updateUI();
            }
        });

        // Re-center canvas on window resize
        $(window).on('resize', () => {
            if ($('#nw-canvas').is(':visible')) {
                centerCanvas();
                updateUI();
            }
        });

        // Initialize: fallback for cases where canvas is directly visible
        setTimeout(() => {
            if ($('#nw-canvas').is(':visible')) {
                autoScale();
                updateUI();
            }
        }, 300);
    });

})