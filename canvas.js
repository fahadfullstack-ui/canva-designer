$(document).ready(() => {
    // Generate Session ID
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    console.log(sessionId)
    $('.shopify-product-form').append('<input type="hidden" name="properties[_dtf_type]" value="canvas" />')
    $('.shopify-product-form').append(`<input type="hidden" class="session_id" name="properties[_dtf_session_id]" value="${sessionId}" />`);
    $('.product-info__quantity-selector').css('display','none')

    const canvas = $('#nw-canvas');
    $('body').prepend(canvas);

    let bodyScrollLocked = false;
    let bodyScrollY = 0;
    const prevBodyStyle = { overflow: '', position: '', top: '', width: '', paddingRight: '' };
    const prevHtmlStyle = { overflow: '' };
    const lockBodyScroll = () => {
        if (bodyScrollLocked) return;
        bodyScrollLocked = true;
        const body = document.body;
        const html = document.documentElement;
        bodyScrollY = window.scrollY || 0;
        prevBodyStyle.overflow = body.style.overflow;
        prevBodyStyle.position = body.style.position;
        prevBodyStyle.top = body.style.top;
        prevBodyStyle.width = body.style.width;
        prevBodyStyle.paddingRight = body.style.paddingRight;
        prevHtmlStyle.overflow = html.style.overflow;
        const scrollbarWidth = window.innerWidth - html.clientWidth;
        html.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
        body.style.position = 'fixed';
        body.style.top = `-${bodyScrollY}px`;
        body.style.width = '100%';
        if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    };
    const unlockBodyScroll = () => {
        if (!bodyScrollLocked) return;
        bodyScrollLocked = false;
        const body = document.body;
        const html = document.documentElement;
        html.style.overflow = prevHtmlStyle.overflow;
        body.style.overflow = prevBodyStyle.overflow;
        body.style.position = prevBodyStyle.position;
        body.style.top = prevBodyStyle.top;
        body.style.width = prevBodyStyle.width;
        body.style.paddingRight = prevBodyStyle.paddingRight;
        window.scrollTo(0, bodyScrollY);
    };
    const showCanvas = () => {
        lockBodyScroll();
        $('#nw-canvas').fadeIn(200, function () {
            autoScale();
            updateUI();
        });
    };
    const hideCanvas = () => {
        $('#nw-canvas').fadeOut(200, function () {
            unlockBodyScroll();
        });
    };

    $("#nw-canvas-trg").on('click', function () {
        showCanvas();
    });

    /**
     * APP STATE & CONSTANTS
     */
    const PX_PER_CM = 37.79;
    const GAP_CM = 1.0;
    const FALLBACK_DPI = 360;
    const EXPORT_DPI = 360;

    const FALLBACK_FORMATS = [
        { id: 'custom', name: '56 x 100 cm', width: 56, height: 100, price: 19.90 },
        { id: 'a4', name: 'DIN A4 (21 x 29.7 cm)', width: 21.0, height: 29.7, price: 7.90 },
        { id: 'a3', name: 'DIN A3 (29.7 x 42 cm)', width: 29.7, height: 42.0, price: 12.50 },
    ];

    const parseFormatDimensions = (text) => {
        if (!text) return null;
        const match = String(text).match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
        if (!match) return null;
        const width = parseFloat(match[1].replace(',', '.'));
        const height = parseFloat(match[2].replace(',', '.'));
        if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
        return { width, height };
    };

    const buildFormatsFromShopifyProduct = () => {
        const product = typeof PRODUCT !== 'undefined' ? PRODUCT : null;
        if (!product || !Array.isArray(product.variants)) return null;
        const formats = product.variants.map((v) => {
            const name = v?.option1 || v?.title || '';
            const meta = typeof VARIANT_FORMAT_META !== 'undefined' && VARIANT_FORMAT_META ? VARIANT_FORMAT_META[String(v?.id)] : null;
            const metaW = meta?.widthCm != null ? Number(meta.widthCm) : null;
            const metaH = meta?.heightCm != null ? Number(meta.heightCm) : null;
            const dims = (Number.isFinite(metaW) && Number.isFinite(metaH)) ? { width: metaW, height: metaH } : parseFormatDimensions(name);
            if (!dims) return null;
            const priceMinor = Number(v?.price);
            const price = Number.isFinite(priceMinor) ? priceMinor / 100 : 0;
            return {
                id: String(v.id),
                name,
                width: dims.width,
                height: dims.height,
                price,
                variantId: String(v.id),
                priceMinor
            };
        }).filter(Boolean);
        if (!formats.length) return null;
        return formats;
    };

    let FORMATS = buildFormatsFromShopifyProduct() || FALLBACK_FORMATS;
    if (!FORMATS.length) FORMATS = FALLBACK_FORMATS;

    let state = {
        selectedFormat: FORMATS[0],
        printSmallElements: true,
        items: [],
        savedSheets: [],
        currentSheetIndex: null, // null = new sheet, index = editing a saved sheet
        selectedItemId: null,
        zoom: 0.5,
        originalSheetSnapshot: null,
        isSpaceDown: false,
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

    const initialVariantId = $('.shopify-product-form input[name="id"], form[action="/cart/add"] input[name="id"]').first().val();
    const initialFormat = initialVariantId ? FORMATS.find(f => String(f.variantId || f.id) === String(initialVariantId)) : null;
    if (initialFormat) state.selectedFormat = initialFormat;

    /**
     * UTILS
     */
    const cmToPx = cm => cm * PX_PER_CM;
    const pxToCm = px => px / PX_PER_CM;
    const pxPerCmAtDpi = (dpi) => dpi / 2.54;
    const cmToPxAtDpi = (cm, dpi) => cm * pxPerCmAtDpi(dpi);
    const previewObjectUrls = new Set();
    const formatPrice = (valueMajor) => {
        const currency = typeof CURRENCY !== 'undefined' ? CURRENCY : null;
        const value = Number(valueMajor);
        if (Number.isNaN(value)) return '';
        if (currency) {
            try {
                return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
            } catch (_) {
            }
        }
        return `€${value.toFixed(2)}`;
    };

    const selectShopifyVariantById = (variantId) => {
        if (!variantId) return false;
        const id = String(variantId);
        const $radio = $(`[data-variant-id="${id}"]`).filter('input[type="radio"]').first();
        if ($radio.length) {
            $radio.trigger('click');
            return true;
        }
        const $option = $(`option[data-variant-id="${id}"]`).first();
        if ($option.length) {
            const $select = $option.closest('select');
            $select.val($option.val());
            $select.trigger('change');
            return true;
        }
        const $variantInput = $('.shopify-product-form input[name="id"], form[action="/cart/add"] input[name="id"]').first();
        if ($variantInput.length) {
            $variantInput.val(id);
            $variantInput.trigger('change');
            return true;
        }
        return false;
    };

    const applySelectedVariantToDesigner = (variantId) => {
        if (!variantId) return;
        const id = String(variantId);
        const match = FORMATS.find(f => String(f.variantId || f.id) === id);
        if (!match) return;
        if (state.selectedFormat?.id === match.id) return;
        state.selectedFormat = match;
        autoScale();
        updateUI();
    };

    const getSelectedVariantIdFromDom = () => {
        const id = $('.shopify-product-form input[name="id"], form[action="/cart/add"] input[name="id"]').first().val();
        return id ? String(id) : null;
    };

    const trackPreviewUrl = (url) => {
        if (typeof url === 'string' && url.startsWith('blob:')) previewObjectUrls.add(url);
    };
    const revokeAllPreviewUrls = () => {
        previewObjectUrls.forEach(u => URL.revokeObjectURL(u));
        previewObjectUrls.clear();
    };
    const generateId = (prefix = 'item') => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const getSheetHash = (items, format, options) => {
        const payload = {
            format: { id: format?.id ?? null, variantId: format?.variantId ?? null, w: format.width, h: format.height },
            options: { printSmallElements: options?.printSmallElements ?? null, formatName: options?.formatName ?? null },
            items: items.map(i => ({ x: i.x, y: i.y, w: i.width, h: i.height, r: i.rotation, g: i.groupId, s: i.src, q: i.quantity }))
        };
        return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    };

    const computeUsedBoxCm = (items, format) => {
        if (!items || !items.length) return { x: 0, y: 0, width: format.width, height: format.height };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(item => {
            const w = item.width;
            const h = item.height;
            const rotation = item.rotation || 0;
            const radians = (rotation * Math.PI) / 180;
            const cos = Math.abs(Math.cos(radians));
            const sin = Math.abs(Math.sin(radians));
            const boundingW = w * cos + h * sin;
            const boundingH = w * sin + h * cos;
            const offsetX = (boundingW - w) / 2;
            const offsetY = (boundingH - h) / 2;
            const left = item.x - offsetX;
            const top = item.y - offsetY;
            const right = item.x + w + offsetX;
            const bottom = item.y + h + offsetY;
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, right);
            maxY = Math.max(maxY, bottom);
        });
        const x = Math.max(0, Math.min(format.width, minX));
        const y = Math.max(0, Math.min(format.height, minY));
        const r = Math.max(0, Math.min(format.width, maxX));
        const b = Math.max(0, Math.min(format.height, maxY));
        const width = Math.max(0.01, r - x);
        const height = Math.max(0.01, b - y);
        return { x, y, width, height };
    };

    const crc32 = (() => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[i] = c >>> 0;
        }
        return (bytes) => {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        };
    })();

    const setPngDpi = async (blob, dpi) => {
        if (!blob || blob.type !== 'image/png') return blob;
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (bytes.length < 33) return blob;
        const signatureOk =
            bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
            bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A;
        if (!signatureOk) return blob;

        const ihdrLen = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
        const ihdrType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
        if (ihdrType !== 'IHDR') return blob;
        const insertAt = 8 + 4 + 4 + ihdrLen + 4;

        const ppm = Math.round(dpi / 0.0254);
        const chunkData = new Uint8Array(9);
        chunkData[0] = (ppm >>> 24) & 0xFF;
        chunkData[1] = (ppm >>> 16) & 0xFF;
        chunkData[2] = (ppm >>> 8) & 0xFF;
        chunkData[3] = ppm & 0xFF;
        chunkData[4] = (ppm >>> 24) & 0xFF;
        chunkData[5] = (ppm >>> 16) & 0xFF;
        chunkData[6] = (ppm >>> 8) & 0xFF;
        chunkData[7] = ppm & 0xFF;
        chunkData[8] = 1;

        const typeBytes = new Uint8Array([0x70, 0x48, 0x59, 0x73]);
        const lenBytes = new Uint8Array([0x00, 0x00, 0x00, 0x09]);
        const crcInput = new Uint8Array(typeBytes.length + chunkData.length);
        crcInput.set(typeBytes, 0);
        crcInput.set(chunkData, typeBytes.length);
        const crc = crc32(crcInput);
        const crcBytes = new Uint8Array([
            (crc >>> 24) & 0xFF,
            (crc >>> 16) & 0xFF,
            (crc >>> 8) & 0xFF,
            crc & 0xFF
        ]);

        const chunkBytes = new Uint8Array(lenBytes.length + typeBytes.length + chunkData.length + crcBytes.length);
        chunkBytes.set(lenBytes, 0);
        chunkBytes.set(typeBytes, 4);
        chunkBytes.set(chunkData, 8);
        chunkBytes.set(crcBytes, 17);

        const out = new Uint8Array(bytes.length + chunkBytes.length);
        out.set(bytes.slice(0, insertAt), 0);
        out.set(chunkBytes, insertAt);
        out.set(bytes.slice(insertAt), insertAt + chunkBytes.length);
        return new Blob([out], { type: 'image/png' });
    };
    const DTF_UPLOAD_URL = 'https://dtfworld.hamzadeveloper.com/api/dtf-world/upload';
    async function uploadFile(file, productId, dimensions, sessionId, index,wCm,hCm) {
        let visualProgress = 0;
        const smoothUpdate = (target) => {
            visualProgress += (target - visualProgress) * 0.18;
            const p = Math.max(0, Math.min(100, visualProgress));
            const $bar = $(`.file_percent_${index}`);
            const $label = $(`.file_percent_label_${index}`);
            if ($bar.length) $bar.css('width', `${p}%`);
            if ($label.length) $label.text(`${Math.round(p)}%`);
            if (bestellenProgressState.active && bestellenProgressState.total > 0) {
                const global = ((bestellenProgressState.index - 1) + (p / 100)) / bestellenProgressState.total * 100;
                setBestellenProgress(true, global, `Speichern… (${Math.round(global)}%)`);
            }
        };

        const formData = new FormData();
        formData.append('file', file);
        formData.append('session_id', String(sessionId || ''));
        formData.append('product_id', String(productId || ''));
        formData.append('dimensions', String(dimensions || ''));
        formData.append('widthCm', wCm);
        formData.append('heightCm', hCm);

        const res = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', DTF_UPLOAD_URL, true);
            xhr.upload.onprogress = (e) => {
                if (!e.total) return;
                const percent = Math.round((e.loaded / e.total) * 100);
                smoothUpdate(percent);
            };
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        smoothUpdate(100);
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        reject(e);
                    }
                    return;
                }
                reject(new Error(`upload_failed_${xhr.status}`));
            };
            xhr.onerror = () => reject(new Error('upload_failed'));
            xhr.send(formData);
        });

        return res;
    }

    async function newUploadFile(file, id, dimensionsOverride) {
        const productId = $('.shopify-product-form input[name="id"]').val();
        const sessionId = $('.session_id').val();
        const wCm = dimensionsOverride?.widthCm ?? state.selectedFormat.width;
        const hCm = dimensionsOverride?.heightCm ?? state.selectedFormat.height;
        const dimsString = `${Number(wCm).toFixed(2)} cm x ${Number(hCm).toFixed(2)} cm`;
        const raw = await uploadFile(file, productId, dimsString, sessionId, id,wCm,hCm);
        const res = raw?.data ? raw.data : raw;
        if (res) {
            if (typeof window.UpdateFileMeta === 'function') {
                window.UpdateFileMeta(id, 'uploaded_name', res.fileName);
                window.UpdateFileMeta(id, 'fileId', res.fileId);
                window.UpdateFileMeta(id, 'tempUrl', res.tempUrl);
                window.UpdateFileMeta(id, 'status', 'Uploaded');
                window.UpdateFileMeta(id, 'imagesCount', res.pdfCount);
            }
            $(`.del_file_${id}`).attr('fid', res.fileId);
            $('.shopify-product-form').append(`<input type="hidden" class="file_input_${id}" name="properties[Width_${id}]" value="${wCm}" />`);
            $('.shopify-product-form').append(`<input type="hidden" class="file_input_${id}" name="properties[Height_${id}]" value="${hCm}" />`);
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
    const renderImageCache = new Map();
    const loadRenderImage = (src) => {
        if (!src) return Promise.resolve(null);
        const existing = renderImageCache.get(src);
        if (existing) return existing;
        const p = new Promise((resolve) => {
            const im = new Image();
            im.decoding = 'async';
            if (/^https?:/i.test(src)) im.crossOrigin = 'anonymous';
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = src;
        });
        renderImageCache.set(src, p);
        return p;
    };
    const renderSheetToImage = async (sheet, options) => {
        const dpi = options?.dpi ?? EXPORT_DPI;
        const trimToUsedArea = options?.trimToUsedArea ?? true;
        const usedBox = trimToUsedArea ? computeUsedBoxCm(sheet.items || [], sheet.format) : { x: 0, y: 0, width: sheet.format.width, height: sheet.format.height };
        const widthPx = Math.max(1, Math.round(cmToPxAtDpi(usedBox.width, dpi)));
        const heightPx = Math.max(1, Math.round(cmToPxAtDpi(usedBox.height, dpi)));
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, widthPx, heightPx);
        const srcs = [...new Set((sheet.items || []).map(i => i?.src).filter(Boolean))];
        await Promise.all(srcs.map(loadRenderImage));
        for (const item of sheet.items) {
            if (!item.src) continue;
            const img = await loadRenderImage(item.src);
            if (!img) continue;
            const x = cmToPxAtDpi(item.x - usedBox.x, dpi);
            const y = cmToPxAtDpi(item.y - usedBox.y, dpi);
            const w = cmToPxAtDpi(item.width, dpi);
            const h = cmToPxAtDpi(item.height, dpi);
            const rad = (item.rotation || 0) * Math.PI / 180;
            ctx.save();
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate(rad);
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
            ctx.restore();
        }
        const rawBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.92));
        const blob = await setPngDpi(rawBlob, dpi);
        const fileName = `sheet_${Date.now()}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        return { file, fileName, usedBox, dpi };
    };
    const upsertCurrentSheetToMemory = () => {
        if (state.currentSheetIndex !== null) {
            const sheet = state.savedSheets[state.currentSheetIndex];
            if (!sheet) return;
            sheet.items = [...state.items];
            sheet.format = state.selectedFormat;
            sheet.price = state.selectedFormat.price;
            sheet.options = sheet.options ? { ...sheet.options } : {};
            sheet.options.formatId = state.selectedFormat.id;
            sheet.options.formatName = state.selectedFormat.name;
            sheet.options.variantId = state.selectedFormat.variantId || getSelectedVariantIdFromDom();
            sheet.options.width = state.selectedFormat.width;
            sheet.options.height = state.selectedFormat.height;
            sheet.options.printSmallElements = state.printSmallElements;
            return;
        }
        if (!state.items.length) return;
        const sheet = {
            id: Date.now(),
            format: state.selectedFormat,
            items: [...state.items],
            price: state.selectedFormat.price,
            options: {
                formatId: state.selectedFormat.id,
                formatName: state.selectedFormat.name,
                variantId: state.selectedFormat.variantId || getSelectedVariantIdFromDom(),
                width: state.selectedFormat.width,
                height: state.selectedFormat.height,
                printSmallElements: state.printSmallElements
            }
        };
        state.savedSheets.push(sheet);
        state.currentSheetIndex = state.savedSheets.length - 1;
    };

    const rebuildSheetFormInputs = (sheetIndex, sheet) => {
        const $form = $('.shopify-product-form');
        if (!$form.length) return;

        $form.find(`.file_input_${sheetIndex}`).remove();
        $form.find(`.print_type_${sheetIndex}`).remove();

        const w = sheet?.options?.exportWidth ?? sheet?.format?.width;
        const h = sheet?.options?.exportHeight ?? sheet?.format?.height;
        const url = sheet?.savedUrl || '';
        const name = sheet?.savedFileName || '';

        if (w != null) $form.append(`<input type="hidden" class="file_input_${sheetIndex}" name="properties[Width_${sheetIndex}]" value="${w}" />`);
        if (h != null) $form.append(`<input type="hidden" class="file_input_${sheetIndex}" name="properties[Height_${sheetIndex}]" value="${h}" />`);
        if (url) $form.append(`<input type="hidden" class="file_input_${sheetIndex}" name="properties[_File_${sheetIndex}]" value="${url}" />`);
        if (name) $form.append(`<input type="hidden" class="file_input_${sheetIndex}" name="properties[_dtf_file_name_${sheetIndex}]" value="${name}" />`);
        $form.append(`<input type="hidden" class="print_type_${sheetIndex}" name="properties[Print_Type_${sheetIndex}]" value="${(sheet?.options?.printSmallElements ?? true) ? 'Ja' : ''}">`);
    };

    const getOverlappingItemIds = (items) => {
        const ids = new Set();
        const rects = (items || []).map(item => {
            const isRotated = (item.rotation || 0) % 180 !== 0;
            let x = item.x, y = item.y, w = item.width, h = item.height;
            if (isRotated) {
                x = item.x + (item.width - item.height) / 2;
                y = item.y + (item.height - item.width) / 2;
                w = item.height;
                h = item.width;
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
        return Array.from(ids);
    };

    const saveAllSheets = async () => {
        upsertCurrentSheetToMemory();
        const sheetsToSave = state.savedSheets.filter(s => !!s?.items?.length);
        bestellenProgressState.active = true;
        bestellenProgressState.total = sheetsToSave.length || 0;
        bestellenProgressState.index = 0;
        if (bestellenProgressState.total > 0) setBestellenProgress(true, 0, 'Speichern… (0%)');
        try {
            const $form = $('.shopify-product-form');
            if ($form.length) {
                $form.find('input').filter((_, el) => {
                    if (!(el instanceof HTMLInputElement)) return false;
                    return Array.from(el.classList).some(c => c.startsWith('file_input_') || c.startsWith('print_type_'));
                }).remove();
            }

            for (let index = 0; index < state.savedSheets.length; index++) {
                const sheet = state.savedSheets[index];
                if (!sheet?.items?.length) continue;
                if (bestellenProgressState.total > 0) {
                    bestellenProgressState.index += 1;
                    const base = ((bestellenProgressState.index - 1) / bestellenProgressState.total) * 100;
                    setBestellenProgress(true, base, `Speichern… (${Math.round(base)}%)`);
                }

                const overlapping = getOverlappingItemIds(sheet.items);
                if (overlapping.length) {
                    showToast(`Überlappungen in Bogen ${index + 1}`, 'error');
                    throw new Error('overlap');
                }

                const formatName = sheet?.options?.formatName ?? sheet?.format?.name ?? '';
                const printSmallElements = sheet?.options?.printSmallElements ?? state.printSmallElements;
                const hash = getSheetHash(sheet.items, sheet.format, { printSmallElements, formatName });
                const isAlreadySaved = !!sheet.savedUrl && sheet.lastSavedHash === hash && !!sheet.savedFileName;

                if (!isAlreadySaved) {
                    const { file, fileName, usedBox } = await renderSheetToImage(sheet, { dpi: EXPORT_DPI, trimToUsedArea: true });
                    let uploadRes = null;
                    try {
                        uploadRes = await newUploadFile(file, index + 1, { widthCm: usedBox.width, heightCm: usedBox.height, dpi: EXPORT_DPI });
                    } catch (_) {
                        uploadRes = null;
                    }

                    let tempUrl = null;
                    let fileId = null;
                    let savedFileName = fileName;
                    if (uploadRes && uploadRes.tempUrl) {
                        tempUrl = uploadRes.tempUrl;
                        fileId = uploadRes.fileId || null;
                        if (uploadRes.fileName) savedFileName = uploadRes.fileName;
                    } else {
                        tempUrl = URL.createObjectURL(file);
                        trackPreviewUrl(tempUrl);
                    }

                    sheet.savedUrl = tempUrl;
                    sheet.savedFileName = savedFileName;
                    sheet.fileId = fileId;
                    sheet.lastSavedHash = hash;
                    sheet.options = {
                        ...(sheet.options || {}),
                        formatId: sheet.format?.id ?? null,
                        formatName: sheet.format?.name ?? formatName,
                        variantId: sheet.format?.variantId || getSelectedVariantIdFromDom(),
                        width: sheet.format?.width,
                        height: sheet.format?.height,
                        printSmallElements,
                        exportWidth: usedBox.width,
                        exportHeight: usedBox.height
                    };
                }

                rebuildSheetFormInputs(index + 1, sheet);
            }

            if (bestellenProgressState.total > 0) setBestellenProgress(true, 100, 'Speichern… (100%)');
            setTimeout(() => setBestellenProgress(false), 350);
        } finally {
            bestellenProgressState.active = false;
            bestellenProgressState.total = 0;
            bestellenProgressState.index = 0;
        }
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
        const hash = getSheetHash(sheet.items, sheet.format, { printSmallElements: state.printSmallElements, formatName: state.selectedFormat.name });
        const { file, fileName, usedBox } = await renderSheetToImage(sheet, { dpi: EXPORT_DPI, trimToUsedArea: true });
        let uploadRes = null;
        try {
            const sheetIdx = state.savedSheets.indexOf(sheet) + 1;
            uploadRes = await newUploadFile(file, sheetIdx, { widthCm: usedBox.width, heightCm: usedBox.height, dpi: EXPORT_DPI });
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
            variantId: state.selectedFormat.variantId || getSelectedVariantIdFromDom(),
            width: state.selectedFormat.width,
            height: state.selectedFormat.height,
            printSmallElements: state.printSmallElements,
            exportWidth: usedBox.width,
            exportHeight: usedBox.height
        };
        const $form = $('.shopify-product-form');
        if ($form.length) {
            const idx = state.savedSheets.indexOf(sheet) + 1;
        //     $form.append(`<input type="hidden" name="properties[_Frame_${idx + 1}_Url]" value="${tempUrl}">`);
        //     $form.append(`<input type="hidden" name="properties[_Frame_${idx + 1}_Name]" value="${savedFileName}">`);
        //     $form.append(`<input type="hidden" name="properties[Frame ${idx + 1} Width]" value="${sheet.format.width}">`);
        //     $form.append(`<input type="hidden" name="properties[Frame ${idx + 1} Height]" value="${sheet.format.height}">`);
        //     $form.append(`<input type="hidden" name="properties[Frame ${idx + 1} Format]" value="${sheet.options.formatName}">`);
            $form.find(`.print_type_${idx}`).remove();
            $form.append(`<input type="hidden" class="print_type_${idx}" name="properties[Print_Type_${idx}]" value="${sheet.options.printSmallElements ? 'Ja' : 'Nein'}">`);
        }
        return sheet;
    };
    const showToast = (text, type = 'success') => {
        const bg = type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-slate-800' : 'bg-emerald-600';
        const icon = type === 'error' ? 'alert-triangle' : type === 'info' ? 'info' : 'check-circle-2';
        const $toast = $(`
            <div class="fixed top-4 right-4 z-[999999] ${bg} text-white px-4 py-3 rounded-xl shadow-xl ring-1 ring-white/20 flex items-start gap-3 max-w-[360px] animate-modal-in">
                <div class="mt-0.5 shrink-0">
                    <i data-lucide="${icon}" class="size-5"></i>
                </div>
                <div class="text-sm font-semibold leading-snug break-words">${text}</div>
            </div>
        `);
        $('body').append($toast);
        lucide.createIcons();
        setTimeout(() => { $toast.fadeOut(200, () => $toast.remove()); }, 2000);
    };
    const formatFixed2 = (value) => {
        const n = Number(value);
        return (Number.isFinite(n) ? n : 0).toFixed(2);
    };
    const bestellenProgressState = { active: false, total: 0, index: 0 };
    const setBestellenProgress = (visible, percent, label) => {
        const $wrap = $('#bestellen-progress');
        const $bar = $('#bestellen-progress-bar');
        const $label = $('#bestellen-progress-label');
        if (visible) {
            const p = Math.max(0, Math.min(100, Number(percent) || 0));
            if ($wrap.length) $wrap.removeClass('hidden');
            if ($bar.length) $bar.css('width', `${p}%`);
            if ($label.length) {
                // Also show total size in MB next to label
                const totalMB = calculateTotalSizeMB();
                const text = label || 'Speichern...';
                $label.text(`${text} (${totalMB} MB)`);
                $label.removeClass('hidden');
            }
            return;
        }
        if ($wrap.length) $wrap.addClass('hidden');
        if ($bar.length) $bar.css('width', '0%');
        if ($label.length) { $label.text(''); $label.addClass('hidden'); }
    };
    const setLeftUploadStatus = (visible, title, sub) => {
        const $box = $('#left-upload-status');
        if (!$box.length) return;
        
        if (visible) {
            $box.removeClass('hidden').css('display', 'flex');
            const $title = $('#left-upload-status-title');
            if ($title.length) {
                // If title has spinner HTML inside (legacy), replace with text
                // Actually, our new HTML structure has the spinner separate.
                // Just update text.
                $title.text(title || 'Verarbeite...');
            }
        } else {
            $box.addClass('hidden').css('display', 'none');
        }
    };
    const isCurrentSheetDirty = () => {
        if (state.currentSheetIndex === null) return state.items.length > 0;
        const sheet = state.savedSheets[state.currentSheetIndex];
        if (!sheet) return false;
        const currentHash = getSheetHash(state.items, state.selectedFormat, { printSmallElements: state.printSmallElements, formatName: state.selectedFormat.name });
        const savedHash = getSheetHash(sheet.items, sheet.format, { printSmallElements: sheet.options?.printSmallElements, formatName: sheet.options?.formatName });
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
        next();
    };

    const compressImage = (file, maxSide = 1600, quality = 0.82) => {
        return new Promise((resolve) => {
            const srcUrl = URL.createObjectURL(file);
            trackPreviewUrl(srcUrl);
            const img = new Image();
            img.onload = async () => {
                try {
                    const originalW = img.naturalWidth || 1;
                    const originalH = img.naturalHeight || 1;
                    resolve({ src: srcUrl, width: originalW, height: originalH });
                } catch (_) {
                    resolve({ src: srcUrl, width: img.naturalWidth || 100, height: img.naturalHeight || 100 });
                }
            };
            img.onerror = () => resolve({ src: srcUrl, width: 100, height: 100 });
            img.src = srcUrl;
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
                            if (marker === 0xFFE1) {
                                const exifHeader = view.getUint32(offset + 4);
                                const exifZero = view.getUint16(offset + 8);
                                if (exifHeader === 0x45786966 && exifZero === 0x0000) {
                                    const tiffStart = offset + 10;
                                    const endian = view.getUint16(tiffStart);
                                    const little = endian === 0x4949;
                                    const readU16 = (pos) => view.getUint16(pos, little);
                                    const readU32 = (pos) => view.getUint32(pos, little);
                                    if (readU16(tiffStart + 2) === 0x002A) {
                                        const ifd0Offset = readU32(tiffStart + 4);
                                        const ifd0 = tiffStart + ifd0Offset;
                                        const entryCount = readU16(ifd0);
                                        let xRes = null;
                                        let unit = null;
                                        for (let i = 0; i < entryCount; i++) {
                                            const entry = ifd0 + 2 + i * 12;
                                            const tag = readU16(entry);
                                            const type = readU16(entry + 2);
                                            const count = readU32(entry + 4);
                                            const valueOrOffset = readU32(entry + 8);
                                            if (tag === 0x0128 && (type === 3 || type === 4) && count >= 1) {
                                                unit = type === 3 ? readU16(entry + 8) : valueOrOffset;
                                            }
                                            if (tag === 0x011A && type === 5 && count >= 1) {
                                                const valPos = tiffStart + valueOrOffset;
                                                const num = readU32(valPos);
                                                const den = readU32(valPos + 4);
                                                if (den) xRes = num / den;
                                            }
                                        }
                                        if (xRes && unit) {
                                            if (unit === 2) { resolve(Math.round(xRes)); return; }
                                            if (unit === 3) { resolve(Math.round(xRes * 2.54)); return; }
                                        }
                                    }
                                }
                            }
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
        // Relaxed constraints: allow item to be partially off-screen
        // Just ensure it doesn't get completely lost (keep at least 1cm visible)
        const { width: formatW, height: formatH } = state.selectedFormat;
        const minVisible = 1.0; 

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

        let constrainedX = newX;
        let constrainedY = newY;

        // Ensure at least minVisible is inside
        // Left: right edge must be > 0 + minVisible
        // Right: left edge must be < formatW - minVisible
        // Top: bottom edge must be > 0 + minVisible
        // Bottom: top edge must be < formatH - minVisible
        
        // Bounding Box Left = x - offsetX
        // Bounding Box Right = x - offsetX + boundingW
        // Bounding Box Top = y - offsetY
        // Bounding Box Bottom = y - offsetY + boundingH

        if (constrainedX - offsetX + boundingW < minVisible) constrainedX = minVisible + offsetX - boundingW;
        if (constrainedX - offsetX > formatW - minVisible) constrainedX = formatW - minVisible + offsetX;
        if (constrainedY - offsetY + boundingH < minVisible) constrainedY = minVisible + offsetY - boundingH;
        if (constrainedY - offsetY > formatH - minVisible) constrainedY = formatH - minVisible + offsetY;

        return {
            x: parseFloat(constrainedX.toFixed(2)),
            y: parseFloat(constrainedY.toFixed(2)),
            width: parseFloat(Math.max(0.5, newW).toFixed(2)),
            height: parseFloat(Math.max(0.5, newH).toFixed(2))
        };
    };

    const findBestPosition = (width, height, existingItems, formatW, formatH) => {
        const gap = GAP_CM;
        const items = [...existingItems];
        
        // Helper to check overlap with robust rotation handling
        const checkOverlap = (cx, cy, cw, ch) => {
             // Epsilon for floating point comparisons
             const epsilon = 0.01;

             // Check canvas bounds first
             if (cx < -epsilon || cy < -epsilon || cx + cw > formatW + epsilon || cy + ch > formatH + epsilon) return true;
             
             return items.some(item => {
                 // Calculate Rotated Bounding Box
                 const r = (item.rotation || 0) * Math.PI / 180;
                 const c = Math.abs(Math.cos(r));
                 const s = Math.abs(Math.sin(r));
                 const bbW = item.width * c + item.height * s;
                 const bbH = item.width * s + item.height * c;
                 
                 // Center of item (rotation happens around center)
                 const centerX = item.x + item.width / 2;
                 const centerY = item.y + item.height / 2;
                 
                 // Top-Left of Bounding Box
                 const iX = centerX - bbW / 2;
                 const iY = centerY - bbH / 2;
                 
                 // AABB Check with epsilon (Standard intersection test)
                 // If rectangles do NOT intersect, return false.
                 // Overlap if: !(Right < Left || Left > Right || Bottom < Top || Top > Bottom)
                 return !(cx + cw <= iX + epsilon || cx >= iX + bbW - epsilon || cy + ch <= iY + epsilon || cy >= iY + bbH - epsilon);
             });
        };

        // Potential Y coordinates: 0 and bottom of every item + gap
        // Also add top of every item to check for alignment
        let candidateYs = [0];
        items.forEach(item => {
            const eff = getEffectiveSize(item);
            // Center of item
            const centerX = item.x + item.width / 2;
            const centerY = item.y + item.height / 2;
            // Top-Left of Bounding Box
            const iY = centerY - eff.height / 2;
            
            candidateYs.push(iY + eff.height + gap);
            candidateYs.push(iY + eff.height + 0.1); // Try small gap
            candidateYs.push(iY + eff.height);       // Try no gap
            candidateYs.push(iY);
        });
        candidateYs = [...new Set(candidateYs)].sort((a, b) => a - b);
        candidateYs = candidateYs.filter(y => y < formatH);

        for (const y of candidateYs) {
            // Try Normal (0 deg)
            let candidateXs = [0];
            items.forEach(item => {
                 const eff = getEffectiveSize(item);
                 // Center of item
                 const centerX = item.x + item.width / 2;
                 // Top-Left of Bounding Box
                 const iX = centerX - eff.width / 2;

                 candidateXs.push(iX + eff.width + gap);
                 candidateXs.push(iX + eff.width + 0.1); // Try small gap
                 candidateXs.push(iX + eff.width);       // Try no gap
                 candidateXs.push(iX); // Also try aligning left
            });
            // Also add formatW to candidates to check right alignment? No.
            
            candidateXs = [...new Set(candidateXs)].sort((a, b) => a - b);
            
            // Filter invalid Xs
            const validXs = candidateXs.filter(x => x + width <= formatW);
            
            for (const x of validXs) {
                if (!checkOverlap(x, y, width, height)) return { x, y, rotation: 0 };
            }
            
            // Try Rotated (90 deg)
            if (Math.abs(width - height) > 0.1) {
                const validRotatedXs = candidateXs.filter(x => x + height <= formatW);
                
                for (const x of validRotatedXs) {
                    // Check if rotated bounding box fits (height x width)
                    if (!checkOverlap(x, y, height, width)) {
                        // Found a spot for the BOUNDING BOX.
                        // We need to return the item position such that its rotated bounding box is at (x,y).
                        // Rotated Item has dimensions (height, width) visually.
                        // Center of Rotated Item = (x + height/2, y + width/2)
                        // TopLeft of Unrotated Item = Center - width/2, Center - height/2
                        //                           = (x + height/2 - width/2, y + width/2 - height/2)
                        
                        return { 
                            x: parseFloat((x + height/2 - width/2).toFixed(2)), 
                            y: parseFloat((y + width/2 - height/2).toFixed(2)), 
                            rotation: 90 
                        };
                    }
                }
            }
        }
        
        // Fallback: Just place at bottom
        const maxY = items.reduce((max, i) => {
            const eff = getEffectiveSize(i);
            const centerY = i.y + i.height / 2;
            const iY = centerY - eff.height / 2;
            return Math.max(max, iY + eff.height);
        }, 0);
        
        return { x: 0, y: maxY + gap, rotation: 0 };
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

        const placedItems = [];
        let overflowCount = 0;

        itemsToPlace.forEach((item, index) => {
            item.id = `layout-${Date.now()}-${index}`;
            
            // Use Smart Placement (findBestPosition) for every item
            // This ensures we fill gaps (holes) and pack densely
            const pos = findBestPosition(item.rawW, item.rawH, placedItems, formatW, formatH);
            
            // Check if the item actually fits on the canvas
            // findBestPosition tries to find a spot, but if canvas is full, it might return a Y that overflows
            const placedW = (pos.rotation % 180 !== 0) ? item.rawH : item.rawW;
            const placedH = (pos.rotation % 180 !== 0) ? item.rawW : item.rawH;
            
            if (pos.y + placedH <= formatH && pos.x + placedW <= formatW) {
                placedItems.push({
                    ...item,
                    x: pos.x,
                    y: pos.y,
                    rotation: (item.rotation || 0) + pos.rotation
                });
            } else {
                overflowCount++;
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
    let lastRulersKey = null;
    const renderRulers = () => {
        const key = `${state.selectedFormat.width}x${state.selectedFormat.height}`;
        if (key === lastRulersKey) return;
        lastRulersKey = key;
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
            upsertCurrentSheetToMemory();
            state.currentSheetIndex = null;
            state.items = [];
            state.selectedItemId = null;
            updateUI();
        });
        $tabs.append($newTab);

        // Add spacer to push BESTELLEN button to right
        $tabs.append($('<div class="flex-1"></div>'));

        // Add BESTELLEN button (Order button) - right side
        const $orderBtn = $(`
                        <button id="bestellen-btn" type="button" class="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105">
                            <i data-lucide="shopping-bag" class="size-5"></i>
                            <span>BESTELLEN</span>
                        </button>
                    `).on('click', (e) => { e.preventDefault(); e.stopPropagation(); openOrderModal(); });
        $tabs.append($orderBtn);

        // Add Close button (X) - to close canvas
        const $closeBtn = $(`
                        <button id="close-canvas-btn" type="button" class="flex items-center justify-center w-10 h-10 ml-3 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 rounded-xl transition-all duration-200" title="Schließen">
                            <i data-lucide="x" class="size-6"></i>
                        </button>
                    `).on('click', () => {
            hideCanvas();
        });
        $tabs.append($closeBtn);

        lucide.createIcons();
    };

    // Switch to a saved sheet for editing
    const switchToSheet = (index) => {
        upsertCurrentSheetToMemory();
        state.currentSheetIndex = index;
        const sheet = state.savedSheets[index];
        state.items = [...sheet.items];
        state.selectedFormat = sheet.format;
        state.printSmallElements = sheet.options?.printSmallElements ?? state.printSmallElements;
        state.selectedItemId = null;
        state.originalSheetSnapshot = { items: JSON.parse(JSON.stringify(sheet.items)), format: { ...sheet.format } };
        updateUI();
    };

    // Open the Order Modal with all projects
    const openOrderModal = () => {
        void (async () => {
            const $orderBtn = $('#bestellen-btn');
            const $checkoutBtn = $('#btn-checkout');
            const originalOrderHtml = $orderBtn.length ? $orderBtn.html() : null;
            const originalCheckoutHtml = $checkoutBtn.length ? $checkoutBtn.html() : null;
            const setLoading = (loading) => {
                if ($orderBtn.length && originalOrderHtml !== null) {
                    $orderBtn.prop('disabled', loading);
                    if (loading) {
                        $orderBtn.removeClass('hover:from-emerald-600 hover:to-green-700 hover:shadow-xl transform hover:scale-105');
                        $orderBtn.html('<svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="4" fill="none" opacity="0.3"/><path d="M12 2 a10 10 0 0 1 10 10" stroke="white" stroke-width="4" fill="none"/></svg><span>Speichern…</span>');
                    } else {
                        $orderBtn.html(originalOrderHtml);
                    }
                }
                if ($checkoutBtn.length && originalCheckoutHtml !== null) {
                    $checkoutBtn.prop('disabled', loading);
                    if (loading) {
                        $checkoutBtn.html('<svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="4" fill="none" opacity="0.3"/><path d="M12 2 a10 10 0 0 1 10 10" stroke="white" stroke-width="4" fill="none"/></svg><span>Speichern…</span>');
                    } else {
                        $checkoutBtn.html(originalCheckoutHtml);
                    }
                }
                lucide.createIcons();
            };

            setLoading(true);
            try {
                await saveAllSheets();
            } catch (_) {
                showToast('Speichern fehlgeschlagen', 'error');
                setBestellenProgress(false);
                setLoading(false);
                return;
            }

            updateUI();
            if (state.collidingIds.length) {
                showToast('Überlappungen beheben!', 'error');
                setLoading(false);
                return;
            }

                const $grid = $('#order-cards-grid').empty();
                const shownSheets = state.savedSheets.filter(s => !!s.savedUrl);
                const clampQty = (val) => {
                    const n = parseInt(String(val), 10);
                    if (!Number.isFinite(n) || n < 1) return 1;
                    return n;
                };
                const recomputeTotals = () => {
                    let totalPrice = 0;
                    let totalQty = 0;
                    shownSheets.forEach((sheet, index) => {
                        const qty = clampQty(sheet.orderQty ?? 1);
                        sheet.orderQty = qty;
                        totalQty += qty;
                        totalPrice += (sheet.price || sheet.format.price) * qty;
                        $grid.find(`.sheet-qty[data-index="${index}"]`).val(String(qty));
                        $grid.find(`.sheet-line-price[data-index="${index}"]`).text(formatPrice((sheet.price || sheet.format.price) * qty));
                    });
                    $('#order-product-count').text(totalQty);
                    $('#order-total-price').text(formatPrice(totalPrice));
                };

        shownSheets.forEach((sheet, index) => {
            sheet.orderQty = clampQty(sheet.orderQty ?? 1);

            // Calculate preview dimensions (fit within card while maintaining aspect ratio)
            const sheetW = sheet.options?.exportWidth ?? sheet.format.width;
            const sheetH = sheet.options?.exportHeight ?? sheet.format.height;
            const previewMaxW = 180;
            const previewMaxH = 180;
            const scale = Math.min(previewMaxW / cmToPx(sheetW), previewMaxH / cmToPx(sheetH));
            const previewW = cmToPx(sheetW) * scale;
            const previewH = cmToPx(sheetH) * scale;

            // Generate positioned items for preview
            const previewItemsHtml = sheet.items.map(item => {
                const usedBox = sheet.options?.exportWidth && sheet.options?.exportHeight ? computeUsedBoxCm(sheet.items || [], sheet.format) : { x: 0, y: 0 };
                const itemW = cmToPx(item.width) * scale;
                const itemH = cmToPx(item.height) * scale;
                const itemX = cmToPx(item.x - usedBox.x) * scale;
                const itemY = cmToPx(item.y - usedBox.y) * scale;
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
                                            <span class="text-blue-600 font-medium">${(sheet.options?.exportWidth ?? sheet.format.width).toFixed(2)} cm</span>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <span>Höhe:</span>
                                            <span class="text-blue-600 font-medium">${(sheet.options?.exportHeight ?? sheet.format.height).toFixed(2)} cm</span>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <span>Elemente < 1mm drucken:</span>
                                            <span class="text-blue-600 font-medium">${(sheet.options?.printSmallElements ?? true) ? 'Ja' : 'Nein'}</span>
                                        </div>
                                    </div>
                                    <div class="flex items-center justify-between text-sm mb-3">
                                        <span class="text-slate-500">Preis:</span>
                                        <span class="sheet-line-price font-bold text-slate-900" data-index="${index}">${formatPrice((sheet.price || sheet.format.price) * sheet.orderQty)}</span>
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
                const next = clampQty($input.val()) + 1;
                $input.val(String(next));
                sheet.orderQty = next;
                recomputeTotals();
            });

            $card.find('.qty-minus').on('click', () => {
                const $input = $card.find('.sheet-qty');
                const next = Math.max(1, clampQty($input.val()) - 1);
                $input.val(String(next));
                sheet.orderQty = next;
                recomputeTotals();
            });
            $card.find('.sheet-qty').on('input', () => {
                sheet.orderQty = clampQty($card.find('.sheet-qty').val());
                recomputeTotals();
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

        recomputeTotals();

                $('#order-modal').removeClass('hidden');
                lucide.createIcons();
            setLoading(false);
        })();
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
            updateUI();
            if (state.collidingIds.length) {
                showToast('Überlappungen beheben!', 'error');
            } else {
                showToast('Gespeichert');
            }
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
        state.zoom = Math.max(0.1, Math.min(10, state.zoom)); // Clamp to valid range
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

    const clampPanToViewport = () => {
        const $viewport = $('#pan-viewport');
        if (!$viewport.length) return;
        const viewportW = $viewport.width();
        const viewportH = $viewport.height();
        const sheetW = cmToPx(state.selectedFormat.width) * state.zoom;
        const sheetH = cmToPx(state.selectedFormat.height) * state.zoom;
        const padding = 40;

        let minX = viewportW - sheetW - padding;
        let maxX = padding;
        let minY = viewportH - sheetH - padding;
        let maxY = padding;

        if (sheetW + padding * 2 <= viewportW) {
            minX = maxX = (viewportW - sheetW) / 2;
        }
        if (sheetH + padding * 2 <= viewportH) {
            minY = maxY = (viewportH - sheetH) / 2;
        }

        state.panX = Math.min(maxX, Math.max(minX, state.panX));
        state.panY = Math.min(maxY, Math.max(minY, state.panY));
    };

    let interactionDomUpdatePending = false;
    const applyActiveItemDom = () => {
        if (!state.selectedItemId) return;
        const item = state.items.find(i => i.id === state.selectedItemId);
        if (!item) return;
        const $el = $(`[data-item-id="${item.id}"]`);
        if (!$el.length) return;
        $el.css({
            left: `${cmToPx(item.x)}px`,
            top: `${cmToPx(item.y)}px`,
            width: `${cmToPx(item.width)}px`,
            height: `${cmToPx(item.height)}px`,
            transform: `rotate(${item.rotation}deg)`
        });
    };
    const scheduleActiveItemDomUpdate = () => {
        if (interactionDomUpdatePending) return;
        interactionDomUpdatePending = true;
        requestAnimationFrame(() => {
            interactionDomUpdatePending = false;
            applyActiveItemDom();
        });
    };

    const getClipStyle = (item) => {
        const { width: fW, height: fH } = state.selectedFormat;
        const cx = item.x + item.width / 2;
        const cy = item.y + item.height / 2;
        const rad = -(item.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        
        const transform = (x, y) => {
            const dx = x - cx;
            const dy = y - cy;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            return {
                x: rx + item.width / 2,
                y: ry + item.height / 2
            };
        };

        const p1 = transform(0, 0);
        const p2 = transform(fW, 0);
        const p3 = transform(fW, fH);
        const p4 = transform(0, fH);

        const toPx = (v) => cmToPx(v).toFixed(1);
        return `clip-path: polygon(${toPx(p1.x)}px ${toPx(p1.y)}px, ${toPx(p2.x)}px ${toPx(p2.y)}px, ${toPx(p3.x)}px ${toPx(p3.y)}px, ${toPx(p4.x)}px ${toPx(p4.y)}px);`;
    };

    // Calculate total size of uploaded images in MB
    const calculateTotalSizeMB = () => {
        let totalBytes = 0;
        const uniqueFiles = new Set();
        
        const processItem = (item) => {
             if (item.fileSize && !uniqueFiles.has(item.src)) {
                totalBytes += item.fileSize;
                uniqueFiles.add(item.src);
            }
        };

        // Process active items
        state.items.forEach(processItem);

        // Process saved sheets
        state.savedSheets.forEach((sheet, index) => {
            // If this sheet is currently active, we already processed state.items (which is the latest version)
            if (index === state.currentSheetIndex) return;
            
            if (sheet.items) {
                sheet.items.forEach(processItem);
            }
        });
        
        return (totalBytes / (1024 * 1024)).toFixed(2);
    };

    const updateUI = () => {
        // Render sheet tabs
        renderSheetTabs();

        // Update Total MB in Save Button
        const totalMB = calculateTotalSizeMB();
        const $saveBtn = $('#save-design');
        // Check if we already appended the size span
        let $sizeSpan = $saveBtn.find('.size-info');
        if (!$sizeSpan.length) {
             $saveBtn.append(' <span class="size-info text-xs opacity-80 ml-1"></span>');
             $sizeSpan = $saveBtn.find('.size-info');
        }
        $sizeSpan.text(`(${totalMB} MB)`);

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
            console.log('Rendering format button for', f.name, 'isActive:', isActive);
            const $btn = $(`
            <button class="w-full text-left px-4 py-3 rounded-lg border transition-all flex justify-between items-center ${isActive ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold ring-1 ring-blue-600' : 'bg-[#C2C5CC] border-gray-200 text-slate-700 hover:border-blue-300 hover:brightness-95'}">
                <span>${f.name}</span>
                ${isActive ? '<div class="w-2 h-2 rounded-full bg-blue-600"></div>' : ''}
            </button>
        `).on('click', () => {
                const didSelect = selectShopifyVariantById(f.variantId || f.id);
                console.log('Selected format', f.name, 'Shopify selection success:', didSelect);
                if (!didSelect) {
                    console.log('Falling back to client-side format selection');
                    state.selectedFormat = f;
                    autoScale();
                    updateUI();
                }
            });
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
                    ${u.isPreviewable ? `<img src="${u.src}" class="w-full h-full object-contain">` : `<div class="w-full h-full bg-slate-100 flex items-center justify-center"><i data-lucide="file-text" class="size-4 text-slate-400"></i></div>`}
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
        $('#collision-warning').toggleClass('hidden', state.collidingIds.length === 0);
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
                ${item.isPreviewable ? `<img src="${item.src}" class="w-full h-full object-contain pointer-events-none" draggable="false" style="${getClipStyle(item)}">` : `
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
                    <button class="auto-fill-btn absolute left-1/2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-full shadow-lg flex items-center gap-1.5 whitespace-nowrap z-30" 
                            style="--rotation: ${-item.rotation}deg; transform: translateX(-50%) rotate(var(--rotation));">
                        <i data-lucide="grid-3x3" class="size-4"></i>
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
        $('#total-price-label').text(formatPrice(Number(totalPrice)));

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
            console.log('test',newW,newH);
            
            state.items = state.items.map(item => item.id === activeItem.id ? {
                ...item,
                width: parseFloat(Math.max(0.5, newW).toFixed(2)),
                height: parseFloat(Math.max(0.5, newH).toFixed(2))
            } : item);
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

        $('#zoom-in').on('click', () => {
            state.zoom = Math.min(10, state.zoom + 0.05);
            updateUI();
        });
        $('#zoom-out').on('click', () => {
            state.zoom = Math.max(0.1, state.zoom - 0.05);
            updateUI();
        });

        $('#reset-all').on('click', () => {
            if (confirm('Alles löschen?')) { revokeAllPreviewUrls(); state.items = []; state.savedSheets = []; state.selectedItemId = null; updateUI(); }
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

            const normalizeDpi = (dpi) => {
                const n = Number(dpi);
                if (!Number.isFinite(n)) return FALLBACK_DPI;
                const rounded = Math.round(n);
                if (rounded < 1 || rounded > 2400) return FALLBACK_DPI;
                return rounded;
            };

            const renderPdfPages = async (file) => {
                const lib = window.pdfjsLib;
                if (!lib?.getDocument) throw new Error('pdfjs_missing');
                if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
                    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                }

                const data = await file.arrayBuffer();
                const withTimeout = (promise, ms) => Promise.race([
                    promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('pdf_timeout')), ms))
                ]);

                let doc = null;
                try {
                    doc = await withTimeout(lib.getDocument({ data }).promise, 15000);
                } catch (e) {
                    try {
                        doc = await withTimeout(lib.getDocument({ data, disableWorker: true }).promise, 20000);
                    } catch (_) {
                        throw e;
                    }
                }
                const out = [];

                for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
                    const page = await doc.getPage(pageNumber);
                    const viewport1 = page.getViewport({ scale: 1 });

                    const widthCm = (viewport1.width / 72) * 2.54;
                    const heightCm = (viewport1.height / 72) * 2.54;

                    const maxSidePx = 2400;
                    const baseScale = 2;
                    const largestAtBase = Math.max(viewport1.width, viewport1.height) * baseScale;
                    const scale = largestAtBase > maxSidePx ? (maxSidePx / Math.max(viewport1.width, viewport1.height)) : baseScale;

                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.ceil(viewport.width);
                    canvas.height = Math.ceil(viewport.height);
                    const ctx = canvas.getContext('2d');
                    if (!ctx) continue;

                    await page.render({ canvasContext: ctx, viewport }).promise;

                    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                    if (!blob) continue;
                    const url = URL.createObjectURL(blob);
                    trackPreviewUrl(url);

                    out.push({
                        pageNumber,
                        src: url,
                        widthCm,
                        heightCm,
                        aspectRatio: widthCm / heightCm
                    });
                }

                if (typeof doc.destroy === 'function') doc.destroy();
                return out;
            };

            for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                const file = files[fileIndex];
                const ext = file.name.split('.').pop().toLowerCase();
                if (ext === 'pdf') {
                    try {
                        setLeftUploadStatus(true, 'PDF wird verarbeitet…', file.name);
                        $('#file-input').prop('disabled', true);
                        const pages = await renderPdfPages(file);
                        if (!pages.length) {
                            showToast('PDF hat keine Seiten', 'error');
                        }
                        setLeftUploadStatus(true, 'PDF wird verarbeitet…', `${file.name} (${pages.length} Seiten)`);
                        for (const p of pages) {
                            setLeftUploadStatus(true, 'PDF wird verarbeitet…', `${file.name} – Seite ${p.pageNumber}/${pages.length}`);
                            const groupId = generateId('grp');
                            const fitW = p.widthCm;
                            const fitH = p.heightCm;
                            const startX = (state.selectedFormat.width - fitW) / 2;
                            const startY = (state.selectedFormat.height - fitH) / 2;

                            newUploadedItems.push({
                                id: generateId('upload'),
                                groupId,
                                name: `${file.name} (Seite ${p.pageNumber})`,
                                type: ext,
                                x: startX,
                                y: startY,
                                rotation: 0,
                                originalDpi: FALLBACK_DPI,
                                detected: true,
                                quantity: 1,
                                src: p.src,
                                originalWidth: p.widthCm,
                                originalHeight: p.heightCm,
                                width: fitW,
                                height: fitH,
                                aspectRatio: p.aspectRatio,
                                isPreviewable: true
                            });
                        }
                    } catch (e) {
                        const msg = String(e?.message || '');
                        if (msg.includes('pdfjs_missing')) showToast('PDF Library fehlt', 'error');
                        else if (msg.includes('pdf_timeout')) showToast('PDF dauert zu lange', 'error');
                        else showToast('PDF konnte nicht verarbeitet werden', 'error');
                    } finally {
                        setLeftUploadStatus(false);
                        $('#file-input').prop('disabled', false);
                    }

                    $('#upload-label').text(`${fileIndex + 1}/${files.length} verarbeitet...`);
                    continue;
                }

                const isImage = ['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext);
                if (isImage) setLeftUploadStatus(true, 'Bild wird verarbeitet…', file.name);
                
                const detectedDpi = isImage ? await detectImageDPI(file) : null;
                const finalDpi = FALLBACK_DPI;
                const groupId = generateId('grp');
                const baseItem = { 
                    id: generateId('upload'), 
                    groupId, 
                    name: file.name, 
                    type: ext, 
                    x: 0, 
                    y: 0, 
                    rotation: 0, 
                    originalDpi: finalDpi, 
                    detected: false, 
                    quantity: 1,
                    fileSize: file.size // Store file size for MB calculation
                };

                if (isImage) {
                    // Use compression for large images
                    const compressed = await compressImage(file);
                    if (!compressed) {
                        setLeftUploadStatus(false);
                        continue;
                    }

                    const img = new Image();
                    await new Promise(resolve => {
                        img.onload = () => {
                            const wCm = (compressed.width / finalDpi) * 2.54;
                            const hCm = (compressed.height / finalDpi) * 2.54;
                            const aspectRatio = compressed.width / compressed.height;

                            const fitW = wCm;
                            const fitH = hCm;
                            // Start centered by default, but smart placement will override in manual mode
                            const startX = (state.selectedFormat.width - fitW) / 2;
                            const startY = (state.selectedFormat.height - fitH) / 2;

                            newUploadedItems.push({
                                ...baseItem,
                                src: compressed.src,
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
                        img.src = compressed.src;
                    });

                    // Update progress
                    setLeftUploadStatus(false);
                    $('#upload-label').text(`${fileIndex + 1}/${files.length} verarbeitet...`);
                } else {
                    newUploadedItems.push({ ...baseItem, src: null, width: 21.0, height: 29.7, originalWidth: 21.0, originalHeight: 29.7, aspectRatio: 21.0 / 29.7, isPreviewable: false });
                }
            }

            // Reset upload label
            $('#upload-label').text('Datei hinzufügen');

            // Skip auto-layout in manual mode - use pre-calculated positions
            if (state.manualMode) {
                // Use Smart Placement to find the next available spot
                const placed = [];
                // Clone existing items to simulate progressive placement
                let tempItems = [...state.items];
                
                for (const item of newUploadedItems) {
                    const pos = findBestPosition(item.width, item.height, tempItems, state.selectedFormat.width, state.selectedFormat.height);
                    const newItem = {
                        ...item,
                        id: generateId('item'),
                        x: pos.x,
                        y: pos.y,
                        rotation: pos.rotation
                    };
                    placed.push(newItem);
                    tempItems.push(newItem);
                }
                
                state.items = tempItems;
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
            if (state.manualMode) {
                state.items = state.items.map(i => i.groupId === active.groupId ? {
                    ...i,
                    width: parseFloat(Math.max(0.5, i.originalWidth).toFixed(2)),
                    height: parseFloat(Math.max(0.5, i.originalHeight).toFixed(2))
                } : i);
                state.selectedItemId = state.items.find(i => i.groupId === active.groupId)?.id;
            } else {
                const updated = state.items.map(i => i.groupId === active.groupId ? { ...i, width: i.originalWidth, height: i.originalHeight } : i);
                const { placedItems } = calculateLayout(updated, state.selectedFormat.width, state.selectedFormat.height);
                state.items = placedItems;
                state.selectedItemId = state.items.find(i => i.groupId === active.groupId)?.id;
            }
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
            upsertCurrentSheetToMemory();
            state.currentSheetIndex = null;
            state.items = [];
            state.selectedItemId = null;
            updateUI();
        });

        $('#btn-checkout').on('click', () => {
            openOrderModal();
        });

        $('#close-order-modal').on('click', () => {
            $('#order-modal').addClass('hidden');
        });

        $('#btn-add-to-cart').on('click', async () => {
            const saved = state.savedSheets.filter(s => !!s.savedUrl);
            if (!saved.length) { showToast('Keine gespeicherten Bögen', 'info'); return; }

            const $addBtn = $('#btn-add-to-cart');
            const originalAddHtml = $addBtn.length ? $addBtn.html() : null;
            if ($addBtn.length) {
                $addBtn.prop('disabled', true);
                $addBtn.html('<svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="4" fill="none" opacity="0.3"/><path d="M12 2 a10 10 0 0 1 10 10" stroke="white" stroke-width="4" fill="none"/></svg><span>In den Warenkorb…</span>');
                lucide.createIcons();
            }

            try {
                const cartItemsComponents = document.querySelectorAll('cart-items-component');
                const sectionIds = [];
                cartItemsComponents.forEach((item) => {
                    if (item instanceof HTMLElement && item.dataset.sectionId) sectionIds.push(item.dataset.sectionId);
                });

                const cartAddUrl = (typeof Theme !== 'undefined' && Theme?.routes?.cart_add_url) ? Theme.routes.cart_add_url : '/cart/add';
                const cartAddEndpoint = String(cartAddUrl || '').endsWith('.js') ? String(cartAddUrl) : `${String(cartAddUrl)}.js`;
                let lastSections = null;

                const fallbackVariantId = getSelectedVariantIdFromDom();
                for (let i = 0; i < saved.length; i++) {
                    const sheet = saved[i];
                    const variantId = String(sheet?.format?.variantId || sheet?.options?.variantId || fallbackVariantId || '');
                    if (!variantId) { showToast('Variante fehlt', 'error'); return; }
                    const qty = Math.max(1, parseInt(String(sheet?.orderQty ?? 1), 10) || 1);
                    const idx = i + 1;

                    const formData = new FormData();
                    formData.append('id', variantId);
                    formData.append('quantity', String(qty));
                    formData.append(`properties[_dtf_file_quantity_${idx}]`, String(qty));
                    if (sectionIds.length) formData.append('sections', sectionIds.join(','));
                    formData.append(`properties[File Type]`, 'Effect');
                    formData.append(`properties[_dtf_type]`, 'canvas');
                    formData.append(`properties[_dtf_session_id]`, sessionId);
                    // formData.append(`properties[_dtf_sheet_id]`, String(sheet.id ?? i + 1));
                    // formData.append(`properties[St]`, String(qty));
                    formData.append(`properties[_File_${idx}]`, String(sheet.savedUrl || ''));
                    formData.append(`properties[_dtf_file_name_${idx}]`, String(sheet.savedFileName || ''));
                    formData.append(`properties[Print_Type_${idx}]`, (sheet.options?.printSmallElements ?? true) ? 'Ja' : 'Nein');
                    formData.append(`properties[Width_${idx}]`, formatFixed2(sheet.options?.exportWidth ?? sheet.format?.width ?? 0));
                    formData.append(`properties[Height_${idx}]`, formatFixed2(sheet.options?.exportHeight ?? sheet.format?.height ?? 0));

                    const resp = await fetch(cartAddEndpoint, {
                        method: 'POST',
                        body: formData,
                        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
                    });
                    const data = await resp.json();
                    if (data?.status) {
                        showToast(data?.message || 'In den Warenkorb fehlgeschlagen', 'error');
                        return;
                    }
                    lastSections = data?.sections || lastSections;
                }

                // if (lastSections) {
                //   document.documentElement.dispatchEvent(
                //     new CustomEvent('cart:refresh', { bubbles: true })
                //   );
                // }

                try {
                    const cartResp = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
                    const cart = await cartResp.json();
                    document.dispatchEvent(new CustomEvent('cart:update', {
                        bubbles: true,
                        detail: {
                            resource: cart,
                            sourceId: 'canvas-designer',
                            data: {
                                source: 'canvas-designer',
                                itemCount: cart?.item_count ?? 0,
                                sections: lastSections || undefined
                            }
                        }
                    }));
                } catch (_) {
                    document.dispatchEvent(new CustomEvent('cart:update', {
                        bubbles: true,
                        detail: {
                            resource: {},
                            sourceId: 'canvas-designer',
                            data: { source: 'canvas-designer', sections: lastSections || undefined }
                        }
                    }));
                }

                $('#order-modal').addClass('hidden');
                hideCanvas();

                revokeAllPreviewUrls();
                state.savedSheets = [];
                state.items = [];
                state.currentSheetIndex = null;
                state.selectedItemId = null;
                updateUI();

                window.location.href = '/cart';
            } finally {
                if ($addBtn.length && originalAddHtml !== null) {
                    $addBtn.prop('disabled', false);
                    $addBtn.html(originalAddHtml);
                    lucide.createIcons();
                }
            }
        });

        $(window).on('mousemove', (e) => {
            if (!state.selectedItemId) return;

            // Handle dragging
            if (state.isDragging) {
                throttledUpdate(() => {
                    const rect = $('#print-sheet')[0].getBoundingClientRect();
                    const mouseX = (e.clientX - rect.left) / state.zoom;
                    const mouseY = (e.clientY - rect.top) / state.zoom;
                    const active = state.items.find(i => i.id === state.selectedItemId);
                    if (!active) return;
                    const nX = pxToCm(mouseX - state.dragOffset.x);
                    const nY = pxToCm(mouseY - state.dragOffset.y);
                    state.items = state.items.map(i => i.id === state.selectedItemId ? { ...i, x: parseFloat(nX.toFixed(2)), y: parseFloat(nY.toFixed(2)) } : i);
                    scheduleActiveItemDomUpdate();
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
                    state.items = state.items.map(i => i.id === state.selectedItemId ? {
                        ...i,
                        x: parseFloat(resized.x.toFixed(2)),
                        y: parseFloat(resized.y.toFixed(2)),
                        width: parseFloat(Math.max(0.5, resized.width).toFixed(2)),
                        height: parseFloat(Math.max(0.5, resized.height).toFixed(2))
                    } : i);
                    scheduleActiveItemDomUpdate();
                });
            }
            // Note: Rotation is now click-based (90° increments), no drag rotation
        }).on('mouseup', () => {
            const didInteract = state.isDragging || state.isResizing;
            if (state.isDragging) $('.item-dragging').removeClass('item-dragging');
            if (state.isResizing) $('.item-resizing').removeClass('item-resizing');
            state.isDragging = false;
            state.isResizing = false;
            state.resizeHandle = null;
            if (didInteract) updateUI();
        });

        $('#print-sheet').on('click', () => { state.selectedItemId = null; updateUI(); });

        // ===== FIGMA-STYLE PAN & ZOOM =====

        // Mouse wheel zoom (Ctrl+wheel only)
        $('#pan-viewport').on('wheel', (e) => {
            if (!e.originalEvent.ctrlKey && !e.originalEvent.metaKey) return;
            e.preventDefault();
            const $viewport = $('#pan-viewport');
            const rect = $viewport[0].getBoundingClientRect();
            const mouseX = e.originalEvent.clientX - rect.left;
            const mouseY = e.originalEvent.clientY - rect.top;

            const oldZoom = state.zoom;
            const factor = Math.pow(1.0015, -e.originalEvent.deltaY);
            const newZoom = Math.max(0.1, Math.min(10, oldZoom * factor));
            if (Math.abs(newZoom - oldZoom) < 0.0001) return;

            const canvasX = (mouseX - state.panX) / oldZoom;
            const canvasY = (mouseY - state.panY) / oldZoom;

            state.zoom = newZoom;
            state.panX = mouseX - canvasX * newZoom;
            state.panY = mouseY - canvasY * newZoom;
            updateUI();
        });

        // Pan with mouse drag (hand tool)
        $('#pan-viewport').on('mousedown', (e) => {
            const $target = $(e.target);
            if ($target.closest('#zoom-in, #zoom-out, #zoom-label').length) return;

            const isLeft = e.button === 0;
            const isMiddle = e.button === 1;
            if (!(state.isSpaceDown || isMiddle || isLeft)) return;
            if (!state.isSpaceDown) {
                if ($target.closest('#items-layer').length &&
                    ($target.closest('.canvas-item').length || $target.closest('.item-handle').length)) {
                    return;
                }
            }

            // Start panning
            state.isPanning = true;
            state.panStartX = e.clientX;
            state.panStartY = e.clientY;
            state.panStartPanX = state.panX;
            state.panStartPanY = state.panY;
            $('#pan-viewport').css('cursor', 'grabbing');
            document.body.style.userSelect = 'none';
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
                document.body.style.userSelect = '';
            }
        });

        // Aspect ratio lock toggle
        $(document).on('click', '#toggle-aspect-lock', () => {
            state.aspectRatioLocked = !state.aspectRatioLocked;
            updateUI();
        });

        $(document).on('keydown', (e) => {
            if (e.code !== 'Space') return;
            if (state.isSpaceDown) return;
            state.isSpaceDown = true;
            if ($('#nw-canvas').is(':visible')) e.preventDefault();
        });
        $(document).on('keyup', (e) => {
            if (e.code !== 'Space') return;
            state.isSpaceDown = false;
            if ($('#nw-canvas').is(':visible')) e.preventDefault();
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
        
        $(document).on('change','input[name="id"]',function(){
          const variantId = $(this).val();
          console.log('Received variant:changed event', variantId);
          if (variantId) applySelectedVariantToDesigner(String(variantId));
        })

        document.addEventListener('variant:update', (event) => {
            console.log('Received variant:update event', event);
            const variantId = event?.detail?.resource?.id;
            if (variantId) applySelectedVariantToDesigner(String(variantId));
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
