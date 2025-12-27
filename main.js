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
const MOBILE_DRAG_THRESHOLD = 50; // Pixels to drag before flip
const DESKTOP_DRAG_THRESHOLD = 30;
const MOBILE_FLIP_COOLDOWN = 300; // Prevent rapid flips on mobile
const ANIMATION_DURATION = 400;
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
const currentPageEl = document.getElementById('currentPage');
const currentPageImg = document.getElementById('currentPageImg');
const currentPageNum = document.getElementById('currentPageNum');
const thumbnails = document.getElementById('thumbnails');
const loading = document.getElementById('loading');

// Easing function for smooth animation
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Apply realistic page curl effect
function applyPageCurl(element, progress, direction) {
    // direction: 1 for flipping forward, -1 for flipping backward
    const angle = progress * 180 * direction;
    const perspective = 1500;
    const shadow = Math.sin(progress * Math.PI) * 0.6;
    
    element.style.transform = `
        perspective(${perspective}px)
        rotateY(${angle}deg)
    `;
    
    element.style.boxShadow = `
        ${direction > 0 ? '-' : ''}${shadow * 20}px 0 ${shadow * 40}px rgba(0,0,0,${shadow * 0.4})
    `;
    
    const gradient = direction > 0 
        ? `linear-gradient(to left, rgba(0,0,0,${shadow * 0.2}), transparent 50%)`
        : `linear-gradient(to right, rgba(0,0,0,${shadow * 0.2}), transparent 50%)`;
    
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
                ctx.globalAlpha = 0.95;
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
        const pdfPageNum = pageIndex;
        
        console.log(`Rendering page ${pageIndex} (PDF page ${pdfPageNum})`);
        
        if (!pdfDoc || pdfPageNum < 1 || pdfPageNum > pdfDoc.numPages) {
            console.warn(`Invalid page ${pdfPageNum}`);
            renderQueue = renderQueue.filter(p => p !== pageIndex);
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
    ].filter(p => p >= 0 && p < numPages);
    
    for (const pageIdx of pagesToPreload) {
        if (!pageCache[pageIdx] && !renderQueue.includes(pageIdx)) {
            renderPageToImage(pageIdx).catch(() => {});
        }
    }
}

// Process PDF
async function processPDF(arrayBuffer) {
    try {
        loading.classList.add('active');
        
        // Clear previous PDF data
        pageCache = {};
        renderQueue = [];
        pageImages = ['assets/front-cover.jpg', 'assets/back-cover.jpg'];
        
        const typedArray = new Uint8Array(arrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        pdfDoc = pdf;
        
        console.log(`PDF loaded with ${pdf.numPages} pages`);
        
        // Set page count (covers + PDF pages)
        numPages = pdf.numPages + 2;
        pageImages[0] = 'assets/front-cover.jpg';
        pageImages[numPages - 1] = 'assets/back-cover.jpg';
        
        // Pre-populate cache with covers
        pageCache[0] = 'assets/front-cover.jpg';
        pageCache[numPages - 1] = 'assets/back-cover.jpg';
        
        currentPage = 0;
        
        // Start rendering first PDF pages in background
        console.log(`Starting to render pages 1-2`);
        renderPageToImage(1);
        renderPageToImage(2);
        
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

// Update page display - SINGLE PAGE VIEW
function updateDisplay() {
    console.log(`Updating display: currentPage=${currentPage}, numPages=${numPages}`);
    
    // Reset transforms and shadows
    currentPageEl.style.transform = '';
    currentPageEl.style.boxShadow = '';
    currentPageEl.style.background = '';
    
    // Update page number
    currentPageNum.textContent = currentPage + 1;
    
    // Load current page
    const pageToLoad = currentPage;
    
    if (pageCache[pageToLoad]) {
        currentPageImg.src = pageCache[pageToLoad];
        console.log(`Loaded cached page ${pageToLoad}`);
    } else {
        // Show placeholder while loading
        currentPageImg.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3ELoading...%3C/text%3E%3C/svg%3E';
        console.log(`Rendering page ${pageToLoad}...`);
        
        renderPageToImage(pageToLoad).then(img => {
            if (img && pageToLoad === currentPage) {
                currentPageImg.src = img;
                pageCache[pageToLoad] = img;
                console.log(`Successfully loaded page ${pageToLoad}`);
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

// Update thumbnails - SINGLE PAGE VIEW
function updateThumbnails() {
    thumbnails.innerHTML = '';
    
    for (let idx = 0; idx < numPages; idx++) {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail';
        if (idx === currentPage) {
            thumb.classList.add('active');
        }
        thumb.dataset.page = idx;
        
        const thumbImg = document.createElement('img');
        thumbImg.alt = `Page ${idx + 1}`;
        
        if (pageCache[idx]) {
            thumbImg.src = pageCache[idx];
        } else if (idx < 5) {
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

// Animated flip to specific page
function flipToPage(pageNum) {
    console.log(`flipToPage called: pageNum=${pageNum}, currentPage=${currentPage}, isFlipping=${isFlipping}`);
    
    if (isFlipping || pageNum < 0 || pageNum >= numPages) {
        console.log(`Flip blocked: isFlipping=${isFlipping}, pageNum=${pageNum}, valid=${pageNum >= 0 && pageNum < numPages}`);
        return;
    }
    if (pageNum === currentPage) {
        console.log(`Already on page ${pageNum}`);
        return;
    }
    
    isFlipping = true;
    const direction = pageNum > currentPage ? 1 : -1;
    const startTime = performance.now();
    const duration = ANIMATION_DURATION;
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(elapsed / duration, 1);
        const progress = easeInOutCubic(rawProgress);
        
        applyPageCurl(currentPageEl, progress, direction);
        
        if (rawProgress < 1) {
            animationFrame = requestAnimationFrame(animate);
        } else {
            currentPage = pageNum;
            updateDisplay();
            updateButtons();
            isFlipping = false;
        }
    }
    
    animationFrame = requestAnimationFrame(animate);
}

// Navigation
prevBtn.addEventListener('click', () => {
    console.log('Prev button clicked');
    if (currentPage > 0) {
        flipToPage(currentPage - 1);
    }
});

nextBtn.addEventListener('click', () => {
    console.log('Next button clicked');
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

// Drag/Swipe functionality
function getClientX(e) {
    return e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
}

function handleDragStart(e) {
    if (isFlipping) return;
    
    console.log('Drag started');
    isDragging = true;
    dragStart = getClientX(e);
    dragCurrent = dragStart;
    dragPrevious = dragStart;
    dragTimestamp = Date.now();
    dragVelocity = 0;
    
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
}

function handleDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    
    dragCurrent = getClientX(e);
    
    const now = Date.now();
    const timeDelta = Math.max(now - dragTimestamp, 1);
    dragVelocity = (dragCurrent - dragPrevious) / timeDelta * 16;
    
    dragPrevious = dragCurrent;
    dragTimestamp = now;
    
    const dragDistance = dragCurrent - dragStart;
    const threshold = isMobileDevice() || isTouch() ? MOBILE_DRAG_THRESHOLD : DESKTOP_DRAG_THRESHOLD;
    const normalizedDrag = Math.max(-threshold * 3, Math.min(threshold * 3, dragDistance));
    const progress = Math.min(Math.abs(normalizedDrag) / (threshold * 3), 1);
    
    if (normalizedDrag < 0 && currentPage < numPages - 1) {
        // Dragging left - flip forward
        applyPageCurl(currentPageEl, progress, 1);
    } else if (normalizedDrag > 0 && currentPage > 0) {
        // Dragging right - flip backward
        applyPageCurl(currentPageEl, progress, -1);
    } else {
        // Can't flip - reset
        currentPageEl.style.transform = '';
        currentPageEl.style.boxShadow = '';
        currentPageEl.style.background = '';
    }
}

function handleDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    
    const dragDistance = dragCurrent - dragStart;
    console.log(`Drag ended: distance=${dragDistance}, currentPage=${currentPage}`);
    
    // Mobile flip cooldown
    const now = Date.now();
    if (isMobileDevice() || isTouch()) {
        if (now - lastFlipTime < MOBILE_FLIP_COOLDOWN) {
            console.log('Flip cooldown active, snapping back');
            animateSnapBack();
            return;
        }
    }
    
    const threshold = isMobileDevice() || isTouch() ? MOBILE_DRAG_THRESHOLD : DESKTOP_DRAG_THRESHOLD;
    
    // Check if dragged far enough
    if (Math.abs(dragDistance) >= threshold) {
        if (dragDistance < 0 && currentPage < numPages - 1) {
            // Flip forward
            console.log('Flipping forward');
            lastFlipTime = now;
            flipToPage(currentPage + 1);
        } else if (dragDistance > 0 && currentPage > 0) {
            // Flip backward
            console.log('Flipping backward');
            lastFlipTime = now;
            flipToPage(currentPage - 1);
        } else {
            console.log('Cannot flip, snapping back');
            animateSnapBack();
        }
    } else {
        console.log('Drag distance too small, snapping back');
        animateSnapBack();
    }
    
    dragStart = 0;
    dragCurrent = 0;
    dragVelocity = 0;
}

// Smooth snap-back animation
function animateSnapBack() {
    const startTime = performance.now();
    const duration = 200;
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeInOutCubic(progress);
        
        currentPageEl.style.transform = `perspective(1500px) rotateY(${(1 - eased) * 10}deg)`;
        currentPageEl.style.opacity = 0.7 + (eased * 0.3);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            currentPageEl.style.transform = '';
            currentPageEl.style.boxShadow = '';
            currentPageEl.style.background = '';
            currentPageEl.style.opacity = '';
        }
    }
    
    requestAnimationFrame(animate);
}

// Touch event listeners
book.addEventListener('touchstart', (e) => {
    handleDragStart(e);
}, { passive: false });

book.addEventListener('touchmove', (e) => {
    handleDragMove(e);
}, { passive: false });

book.addEventListener('touchend', (e) => {
    handleDragEnd();
}, { passive: false });

// Mouse event listeners
book.addEventListener('mousedown', handleDragStart);
book.addEventListener('mousemove', handleDragMove);
book.addEventListener('mouseup', handleDragEnd);
book.addEventListener('mouseleave', handleDragEnd);

// Visual cursor feedback
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
pageCache[0] = 'assets/front-cover.jpg';
updateDisplay();
updateButtons();

console.log('Flip book initialized');