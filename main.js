// Set up PDF.js worker with fallback
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Global variables
let pdfDoc = null;
let pageImages = ['assets/front-cover.jpg', 'assets/back-cover.jpg'];
let pageCache = {}; // Cache for rendered pages
let renderQueue = []; // Queue of pages being rendered
let currentPage = 0;
let numPages = 2;
let isFlipping = false;
let isDragging = false;
let dragStart = 0;
let dragCurrent = 0;
let dragPrevious = 0;
let dragTimestamp = 0;
let dragVelocity = 0;
let scale = 1;
let flipProgress = 0;
let animationFrame = null;

// Mobile detection and sensitivity settings
const isMobileDevice = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isTouch = () => window.matchMedia('(hover: none)').matches;
const MOBILE_DRAG_THRESHOLD = 40; // Increased threshold for mobile (default 30)
const DESKTOP_DRAG_THRESHOLD = 30;
const MOBILE_FLIP_COOLDOWN = 400; // Prevent rapid flips on mobile
const ANIMATION_DURATION_MOBILE = 600;
const ANIMATION_DURATION_DESKTOP = 400;
let lastFlipTime = 0;

// DOM elements
const pdfUpload = document.getElementById('pdfUpload');
const uploadText = document.getElementById('uploadText');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const bookContainer = document.getElementById('bookContainer');
const book = document.getElementById('book');
const leftPage = document.getElementById('leftPage');
const rightPage = document.getElementById('rightPage');
const leftPageImg = document.getElementById('leftPageImg');
const rightPageImg = document.getElementById('rightPageImg');
const leftPageNum = document.getElementById('leftPageNum');
const rightPageNum = document.getElementById('rightPageNum');
const thumbnails = document.getElementById('thumbnails');
const loading = document.getElementById('loading');

// Easing function for smooth animation
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Apply realistic page curl effect
function applyPageCurl(element, progress, direction) {
    // direction: 1 for right page flipping forward, -1 for left page flipping back
    const angle = progress * -180 * direction;
    const perspective = 1500;
    const skew = Math.sin(progress * Math.PI) * 8 * -direction;
    const shadow = Math.sin(progress * Math.PI) * 0.6;
    
    // Enhanced 3D deformation with barrel distortion
    const scaleX = 1 - (progress * 0.05); // Slight compression during flip
    const scaleY = 1 + (progress * 0.02); // Slight stretch
    const distortion = Math.sin(progress * Math.PI) * 3;
    
    element.style.transform = `
        perspective(${perspective}px)
        rotateY(${angle}deg)
        skewY(${skew}deg)
        scaleX(${scaleX})
        scaleY(${scaleY})
    `;
    
    // Enhanced shadow with darker underside
    const underShadow = shadow * 0.5;
    element.style.boxShadow = `
        ${direction > 0 ? '' : '-'}${shadow * 25}px 0 ${shadow * 50}px rgba(0,0,0,${shadow * 0.4}),
        inset ${direction > 0 ? '' : '-'}${underShadow * 10}px 0 ${underShadow * 15}px rgba(0,0,0,${underShadow * 0.2})
    `;
    
    // Gradient overlay for enhanced depth
    const gradient = direction > 0 
        ? `linear-gradient(to right, rgba(0,0,0,${shadow * 0.25}), transparent 40%, rgba(255,255,255,${shadow * 0.1}))`
        : `linear-gradient(to left, rgba(0,0,0,${shadow * 0.25}), transparent 40%, rgba(255,255,255,${shadow * 0.1}))`;
    
    element.style.background = gradient;
}

// Extract text and images from PDF page
async function extractTextAndImages(page) {
    try {
        const viewport = page.getViewport({ scale: 3 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        return {
            imageData: canvas.toDataURL(),
            viewport: viewport
        };
    } catch (error) {
        console.error('Error extracting content:', error);
        return null;
    }
}

// Composite extracted content on page template with realistic texture
function compositeOnPageTemplate(extractedContent) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const templateImg = new Image();
        templateImg.crossOrigin = 'anonymous';
        templateImg.onload = () => {
            canvas.width = templateImg.width;
            canvas.height = templateImg.height;
            
            // Draw PDF content first
            const contentImg = new Image();
            contentImg.onload = () => {
                // Fill with white background
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw scaled PDF content
                const scale = Math.min(
                    (canvas.width * 0.85) / contentImg.width,
                    (canvas.height * 0.85) / contentImg.height
                );
                
                const scaledWidth = contentImg.width * scale;
                const scaledHeight = contentImg.height * scale;
                const x = (canvas.width - scaledWidth) / 2;
                const y = (canvas.height - scaledHeight) / 2;
                
                ctx.drawImage(contentImg, x, y, scaledWidth, scaledHeight);
                
                // Apply page texture with multiply blend mode for realism
                ctx.globalCompositeOperation = 'multiply';
                ctx.globalAlpha = 0.95; // Slightly transparent for natural look
                ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 1.0;
                ctx.globalCompositeOperation = 'source-over';
                
                resolve(canvas.toDataURL());
            };
            contentImg.src = extractedContent.imageData;
        };
        templateImg.src = 'assets/page.jpg';
    });
}

// Render single page on demand
async function renderPageToImage(pageIndex) {
    // Check cache first
    if (pageCache[pageIndex]) {
        return pageCache[pageIndex];
    }
    
    // Check if already rendering
    if (renderQueue.includes(pageIndex)) {
        return null;
    }
    
    renderQueue.push(pageIndex);
    
    try {
        // Skip covers (they're static)
        if (pageIndex === 0 || pageIndex === numPages - 1) {
            pageCache[pageIndex] = pageImages[pageIndex];
            renderQueue = renderQueue.filter(p => p !== pageIndex);
            return pageImages[pageIndex];
        }
        
        // PDF pages are indexed 1 to pdfDoc.numPages
        // pageIndex 1 = PDF page 1, pageIndex 2 = PDF page 2, etc.
        const pdfPageNum = pageIndex;
        
        console.log(`Rendering page ${pageIndex} (PDF page ${pdfPageNum}), total PDF pages: ${pdfDoc?.numPages}`);       if (!pdfDoc || pdfPageNum < 1 || pdfPageNum > pdfDoc.numPages) {
            console.warn(`Invalid page ${pdfPageNum}, PDF pages: 1-${pdfDoc?.numPages}`);           renderQueue = renderQueue.filter(p => p !== pageIndex);
            return null;
        }
        
        const page = await pdfDoc.getPage(pdfPageNum);
        const extractedContent = await extractTextAndImages(page);
        
        if (extractedContent) {
            const compositedPage = await compositeOnPageTemplate(extractedContent);
            pageCache[pageIndex] = compositedPage;
            console.log(`Successfully rendered page ${pageIndex}`);
            renderQueue = renderQueue.filter(p => p !== pageIndex);
            return compositedPage;
        }
    } catch (error) {
        console.error(`Error rendering page ${pageIndex}:`, error);
    }
    
    renderQueue = renderQueue.filter(p => p !== pageIndex);
    return null;
}

// Pre-load adjacent pages in background
async function preloadAdjacentPages(pageIndex) {
    const pagesToPreload = [
        pageIndex + 1,
        pageIndex - 1,
        pageIndex + 2,
        pageIndex - 2
    ].filter(p => p > 0 && p < numPages);
    
    // Start pre-loading in background (don't await)
    for (const pageIdx of pagesToPreload) {
        if (!pageCache[pageIdx] && !renderQueue.includes(pageIdx)) {
            renderPageToImage(pageIdx).catch(() => {}); // Silent fail for bg loads
        }
    }
}

// Process PDF
async function processPDF(arrayBuffer) {
    try {
        loading.classList.add('active');
        
        // Clear previous PDF data
        pageCache = {}; // Clear page cache
        renderQueue = []; // Clear rendering queue
        pageImages = ['assets/front-cover.jpg', 'assets/back-cover.jpg']; // Reset page images
        
        const typedArray = new Uint8Array(arrayBuffer);
        
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        pdfDoc = pdf;
        
        console.log(`PDF loaded with ${pdf.numPages} pages`);
        
        // Set page count (covers + PDF pages)
        numPages = pdf.numPages + 2; // +2 for front and back covers
        pageImages[0] = 'assets/front-cover.jpg';
        pageImages[numPages - 1] = 'assets/back-cover.jpg';
        
        // Pre-populate cache with covers
        pageCache[0] = 'assets/front-cover.jpg';
        pageCache[numPages - 1] = 'assets/back-cover.jpg';
        
        currentPage = 0;
        
        // Start rendering first visible pages
        console.log(`Starting to render pages 1-2`);
        await renderPageToImage(1);
        await renderPageToImage(2);
        
        updateDisplay();
        updateThumbnails();
        updateButtons();
        
        // Pre-load next pages in background
        preloadAdjacentPages(0);
        
        loading.classList.remove('active');
        uploadText.textContent = 'Upload Different PDF';
    } catch (error) {
        console.error('Error processing PDF:', error);
        loading.classList.remove('active');
        alert('Error loading PDF. Please try another file.');
    }
}

// Handle file upload
pdfUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
        await processPDF(event.target.result);
    };
    reader.readAsArrayBuffer(file);
});

// Update page display with lazy loading - SINGLE PAGE VIEW
function updateDisplay() {
    // Reset transforms and shadows
    leftPage.style.transform = '';
    rightPage.style.transform = '';
    leftPage.style.boxShadow = '';
    rightPage.style.boxShadow = '';
    leftPage.style.background = '';
    rightPage.style.background = '';
    
    // SINGLE PAGE VIEW - forcefully hide left page
    leftPageImg.src = '';
    leftPageNum.style.display = 'none';
    leftPage.style.display = 'none';
    leftPage.style.visibility = 'hidden';
    leftPage.style.width = '0';
    leftPage.style.height = '0';
    leftPage.style.margin = '0';
    leftPage.style.padding = '0';
    
    // Show right page
    rightPage.style.display = 'block';
    rightPage.style.visibility = 'visible';
    rightPageNum.style.display = 'block';
    rightPageNum.textContent = currentPage + 1;
    rightPage.style.width = '';
    
    // Load current page into right page display
    if (pageCache[currentPage]) {
        // Image is already cached, use it
        const cachedImage = pageCache[currentPage];
        rightPageImg.src = cachedImage;
    } else {
        // Image not cached, show placeholder and render
        rightPageImg.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E';
        const pageToLoad = currentPage;
        renderPageToImage(pageToLoad).then(img => {
            if (img && pageToLoad === currentPage) {
                rightPageImg.src = img;
                pageCache[pageToLoad] = img;
            }
        }).catch(err => {
            console.error('Error rendering page:', pageToLoad, err);
        });
    }
    
    pageInfo.textContent = `Page ${currentPage + 1} of ${numPages}`;
    
    // Pre-load adjacent pages
    preloadAdjacentPages(currentPage);
    
    updateThumbnails();
}

// Helper to set page image (handles both URLs and base64)
function setPageImage(imgElement, src) {
    if (src) {
        imgElement.src = src;
    }
}

// Update thumbnails with lazy loading support - SINGLE PAGE VIEW
function updateThumbnails() {
    thumbnails.innerHTML = '';
    
    for (let idx = 0; idx < numPages; idx++) {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail';
        // Only highlight current page in single-page view
        if (idx === currentPage) {
            thumb.classList.add('active');
        }
        thumb.dataset.page = idx;
        
        const thumbImg = document.createElement('img');
        thumbImg.alt = `Page ${idx + 1}`;
        
        // Set source or preload
        if (pageCache[idx]) {
            thumbImg.src = pageCache[idx];
        } else if (idx < 5) {
            // Preload first few thumbnails
            renderPageToImage(idx).then(img => {
                if (img) {
                    thumbImg.src = img;
                    pageCache[idx] = img;
                }
            });
        }
        
        thumb.appendChild(thumbImg);
        thumb.addEventListener('click', () => {
            flipToPage(parseInt(thumb.dataset.page));
        });
        
        thumbnails.appendChild(thumb);
    }
}

// Update button states
function updateButtons() {
    prevBtn.disabled = currentPage <= 0;
    nextBtn.disabled = currentPage >= numPages - 1;
}

// Complete flip animation with momentum
function completeFlipWithMomentum(targetPage, startProgress, direction, targetPageNum, velocity) {
    isFlipping = true;
    const startTime = performance.now();
    const remainingProgress = 1 - startProgress;
    
    // Velocity-based duration: faster drag = faster flip
    const velocityFactor = Math.min(Math.abs(velocity) / 0.5, 1.5);
    const baseDuration = remainingProgress * 600;
    const duration = baseDuration / (0.5 + velocityFactor * 0.5);
    
    // Calculate momentum overshoot
    const momentumOvershoot = Math.min(velocity * 50, 0.15);
    const maxProgress = Math.min(1 + momentumOvershoot, 1.1);
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(elapsed / duration, 1);
        const easedProgress = easeInOutCubic(rawProgress);
        
        // Interpolate from startProgress to maxProgress (with potential overshoot)
        let currentProgress = startProgress + (easedProgress * (maxProgress - startProgress));
        
        // If we overshot, spring back smoothly
        if (currentProgress > 1 && rawProgress < 1) {
            const overshoot = currentProgress - 1;
            const springBack = Math.sin(overshoot * Math.PI) * 0.1;
            currentProgress = 1 - springBack;
        }
        
        applyPageCurl(targetPage, currentProgress, direction);
        
        if (rawProgress < 1) {
            animationFrame = requestAnimationFrame(animate);
        } else {
            // Animation complete
            currentPage = targetPageNum;
            updateDisplay();
            updateButtons();
            isFlipping = false;
            flipProgress = 0;
        }
    }
    
    animationFrame = requestAnimationFrame(animate);
}

// Complete flip animation from current drag position
function completeFlip(targetPage, startProgress, direction, targetPageNum) {
    completeFlipWithMomentum(targetPage, startProgress, direction, targetPageNum, 0);
}

// Animated flip to specific page
function flipToPage(pageNum) {
    if (isFlipping || pageNum < 0 || pageNum >= numPages) return;
    if (pageNum === currentPage) return;
    
    // Change page immediately
    currentPage = pageNum;
    updateDisplay();
    updateButtons();
}

// Navigation
prevBtn.addEventListener('click', () => {
    if (currentPage > 0) {
        flipToPage(currentPage - 1);
    }
});

nextBtn.addEventListener('click', () => {
    if (currentPage < numPages - 1) {
        flipToPage(currentPage + 1);
    }
});

// Zoom controls
zoomInBtn.addEventListener('click', () => {
    scale = Math.min(scale + 0.2, 2);
    bookContainer.style.transform = `scale(${scale})`;
});

zoomOutBtn.addEventListener('click', () => {
    scale = Math.max(scale - 0.2, 0.6);
    bookContainer.style.transform = `scale(${scale})`;
});

// Drag/Swipe functionality with smooth preview
function getClientX(e) {
    return e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
}

function handleDragStart(e) {
    if (isFlipping) return;
    isDragging = true;
    dragStart = getClientX(e);
    dragCurrent = dragStart;
    dragPrevious = dragStart;
    dragTimestamp = Date.now();
    dragVelocity = 0;
    
    // Cancel any ongoing animation
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
}

function handleDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    dragCurrent = getClientX(e);
    
    // Calculate velocity for momentum
    const now = Date.now();
    const timeDelta = Math.max(now - dragTimestamp, 1);
    let velocity = (dragCurrent - dragPrevious) / timeDelta * 16; // Normalized to 60fps
    
    // Reduce velocity on mobile devices for smoother experience
    if (isMobileDevice() || isTouch()) {
        velocity *= 0.5; // 50% velocity reduction on mobile
    }
    
    dragVelocity = velocity;
    dragPrevious = dragCurrent;
    dragTimestamp = now;
    
    const dragDistance = dragCurrent - dragStart;
    // Make maxDrag proportional to page width for better mobile UX
    const pageWidth = rightPage.offsetWidth || window.innerWidth * 0.9;
    const maxDrag = pageWidth * 0.3; // 30% of page width required to flip
    const normalizedDrag = Math.max(-maxDrag, Math.min(maxDrag, dragDistance));
    const progress = Math.min(Math.abs(normalizedDrag) / maxDrag, 1);
    
    // SINGLE PAGE VIEW - always use rightPage for flip animation
    if (normalizedDrag < 0 && currentPage < numPages - 1) {
        // Dragging left - flip forward
        applyPageCurl(rightPage, progress, 1);
    } else if (normalizedDrag > 0 && currentPage > 0) {
        // Dragging right - flip backward
        applyPageCurl(rightPage, progress, -1);
    } else {
        // Reset if can't flip
        rightPage.style.transform = '';
        rightPage.style.boxShadow = '';
        rightPage.style.background = '';
    }
}

function handleDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    
    // Mobile flip cooldown - prevent rapid consecutive flips
    const now = Date.now();
    if (isMobileDevice() || isTouch()) {
        if (now - lastFlipTime < MOBILE_FLIP_COOLDOWN) {
            // Snap back if too soon after last flip
            const dragDistance = dragCurrent - dragStart;
            const pageWidth = rightPage.offsetWidth || window.innerWidth * 0.9;
            const maxDrag = pageWidth * 0.3;
            const normalizedDrag = Math.max(-maxDrag, Math.min(maxDrag, dragDistance));
            const progress = Math.min(Math.abs(normalizedDrag) / maxDrag, 1);
            const direction = dragDistance < 0 ? 1 : -1;
            animateSnapBack(rightPage, progress, direction);
            dragStart = 0;
            dragCurrent = 0;
            dragVelocity = 0;
            return;
        }
        lastFlipTime = now;
    }
    
    const dragDistance = dragCurrent - dragStart;
    // Make maxDrag proportional to page width for better mobile UX
    const pageWidth = rightPage.offsetWidth || window.innerWidth * 0.9;
    const maxDrag = pageWidth * 0.3; // 30% of page width required to flip
    const normalizedDrag = Math.max(-maxDrag, Math.min(maxDrag, dragDistance));
    const progress = Math.min(Math.abs(normalizedDrag) / maxDrag, 1);
    
    // Use higher threshold on mobile devices
    const dragThreshold = (isMobileDevice() || isTouch()) ? 0.4 : 0.3;
    
    // Calculate if momentum should complete the flip
    const momentumThreshold = 0.3; // Velocity threshold
    const momentumComplete = Math.abs(dragVelocity) > momentumThreshold;
    
    if (progress >= dragThreshold || momentumComplete) {
        // User dragged past halfway OR has enough momentum - complete flip
        if (dragDistance < 0 && currentPage < numPages - 1) {
            // Flip forward
            completeFlipWithMomentum(rightPage, progress, 1, currentPage + 1, dragVelocity);
            currentPage = currentPage + 1;
        } else if (dragDistance > 0 && currentPage > 0) {
            // Flip backward
            completeFlipWithMomentum(rightPage, progress, -1, currentPage - 1, dragVelocity);
            currentPage = currentPage - 1;
        } else {
            // Can't flip, snap back
            const direction = dragDistance < 0 ? 1 : -1;
            animateSnapBack(rightPage, progress, direction);
            dragStart = 0;
            dragCurrent = 0;
            dragVelocity = 0;
            return;
        }
        updateDisplay();
        updateButtons();
    } else {
        // Didn't drag far enough and no momentum - snap back smoothly
        const direction = dragDistance < 0 ? 1 : -1;
        animateSnapBack(rightPage, progress, direction);
    }
    
    dragStart = 0;
    dragCurrent = 0;
    dragVelocity = 0;
}

// Smooth snap-back animation when drag is cancelled
function animateSnapBack(targetPage, startProgress, direction) {
    isFlipping = true;
    const startTime = performance.now();
    const duration = 300;
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(elapsed / duration, 1);
        const easedProgress = easeInOutCubic(rawProgress);
        
        // Animate from startProgress back to 0
        const currentProgress = startProgress * (1 - easedProgress);
        
        applyPageCurl(targetPage, currentProgress, direction);
        
        if (rawProgress < 1) {
            animationFrame = requestAnimationFrame(animate);
        } else {
            // Reset everything
            targetPage.style.transform = '';
            targetPage.style.boxShadow = '';
            targetPage.style.background = '';
            isFlipping = false;
        }
    }
    
    animationFrame = requestAnimationFrame(animate);
}

function resetPageTransforms() {
    leftPage.style.transition = 'all 0.3s ease-out';
    rightPage.style.transition = 'all 0.3s ease-out';
    
    setTimeout(() => {
        leftPage.style.transform = '';
        rightPage.style.transform = '';
        leftPage.style.boxShadow = '';
        rightPage.style.boxShadow = '';
        leftPage.style.background = '';
        rightPage.style.background = '';
        
        setTimeout(() => {
            leftPage.style.transition = '';
            rightPage.style.transition = '';
        }, 300);
    }, 10);
}

// Pinch-to-zoom functionality for touch devices
let initialPinchDistance = 0;
let currentPinchScale = 1;
let pinchStartScale = 1;

function getPinchDistance(e) {
    if (e.touches.length < 2) return 0;
    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function handlePinchStart(e) {
    if (e.touches.length === 2) {
        initialPinchDistance = getPinchDistance(e);
        pinchStartScale = scale;
    }
}

function handlePinchMove(e) {
    if (e.touches.length === 2 && initialPinchDistance > 0) {
        e.preventDefault();
        const currentDistance = getPinchDistance(e);
        const scaleFactor = currentDistance / initialPinchDistance;
        
        // Calculate new scale (min 1x, max 3x)
        currentPinchScale = Math.min(Math.max(pinchStartScale * scaleFactor, 1), 3);
        
        // Apply zoom to current page
        const currentPageElement = currentPage === 0 ? leftPage : rightPage;
        if (currentPageElement) {
            currentPageElement.style.transform = `scale(${currentPinchScale})`;
            // Adjust transform origin to center
            currentPageElement.style.transformOrigin = 'center';
            currentPageElement.style.transition = 'none';
        }
    }
}

function handlePinchEnd(e) {
    if (e.touches.length < 2) {
        initialPinchDistance = 0;
        scale = currentPinchScale;
        
        // Smooth transition back if zoomed out
        const currentPageElement = currentPage === 0 ? leftPage : rightPage;
        if (currentPageElement) {
            currentPageElement.style.transition = 'transform 0.3s ease-out';
        }
    }
}

// Add event listeners for drag/swipe
book.addEventListener('mousedown', handleDragStart);
book.addEventListener('mousemove', handleDragMove);
book.addEventListener('mouseup', handleDragEnd);
book.addEventListener('mouseleave', handleDragEnd);

book.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        handlePinchStart(e);
    } else {
        handleDragStart(e);
    }
}, { passive: false });

book.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
        handlePinchMove(e);
    } else {
        handleDragMove(e);
    }
}, { passive: false });

book.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        handlePinchEnd(e);
    }
    handleDragEnd();
});

// Add visual cursor feedback
book.style.cursor = 'grab';
book.addEventListener('mousedown', () => {
    if (!isFlipping) book.style.cursor = 'grabbing';
});
book.addEventListener('mouseup', () => {
    book.style.cursor = 'grab';
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && currentPage > 0) {
        flipToPage(currentPage - 1);
    } else if (e.key === 'ArrowRight' && currentPage < numPages - 1) {
        flipToPage(currentPage + 1);
    }
});

// Initialize display
// Ensure initial page cache is set for cover
pageCache[0] = 'assets/front-cover.jpg';
pageCache[1] = 'assets/back-cover.jpg';
updateDisplay();
updateButtons();