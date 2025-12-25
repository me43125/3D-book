// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global variables
let pdfDoc = null;
let pageImages = ['assets/front-cover.jpg', 'assets/back-cover.jpg'];
let currentPage = 0;
let numPages = 2;
let isFlipping = false;
let isDragging = false;
let dragStart = 0;
let dragCurrent = 0;
let scale = 1;
let flipProgress = 0;
let animationFrame = null;

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
    const angle = progress * -180 * direction; // Negative to flip forward correctly
    const perspective = 2000;
    const skew = Math.sin(progress * Math.PI) * 5 * -direction; // Invert skew direction
    const shadow = Math.sin(progress * Math.PI) * 0.5;
    
    element.style.transform = `
        perspective(${perspective}px)
        rotateY(${angle}deg)
        skewY(${skew}deg)
    `;
    
    element.style.boxShadow = `
        ${direction > 0 ? '' : '-'}${shadow * 20}px 0 ${shadow * 40}px rgba(0,0,0,${shadow * 0.3})
    `;
    
    // Add gradient overlay for depth
    const gradient = direction > 0 
        ? `linear-gradient(to right, rgba(0,0,0,${shadow * 0.2}), transparent 30%)`
        : `linear-gradient(to left, rgba(0,0,0,${shadow * 0.2}), transparent 30%)`;
    
    element.style.background = gradient;
}

// Extract text and images from PDF page
async function extractTextAndImages(page) {
    try {
        const viewport = page.getViewport({ scale: 2 });
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

// Composite extracted content on page template
function compositeOnPageTemplate(extractedContent) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const templateImg = new Image();
        templateImg.crossOrigin = 'anonymous';
        templateImg.onload = () => {
            canvas.width = templateImg.width;
            canvas.height = templateImg.height;
            
            ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
            
            const contentImg = new Image();
            contentImg.onload = () => {
                const scale = Math.min(
                    (canvas.width * 0.85) / contentImg.width,
                    (canvas.height * 0.85) / contentImg.height
                );
                
                const scaledWidth = contentImg.width * scale;
                const scaledHeight = contentImg.height * scale;
                const x = (canvas.width - scaledWidth) / 2;
                const y = (canvas.height - scaledHeight) / 2;
                
                ctx.drawImage(contentImg, x, y, scaledWidth, scaledHeight);
                resolve(canvas.toDataURL());
            };
            contentImg.src = extractedContent.imageData;
        };
        templateImg.src = 'assets/page.jpg';
    });
}

// Process PDF
async function processPDF(arrayBuffer) {
    try {
        loading.classList.add('active');
        const typedArray = new Uint8Array(arrayBuffer);
        
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        pdfDoc = pdf;
        
        const images = [];
        images.push('assets/front-cover.jpg');
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const extractedContent = await extractTextAndImages(page);
            if (extractedContent) {
                const compositedPage = await compositeOnPageTemplate(extractedContent);
                images.push(compositedPage);
            }
        }
        
        images.push('assets/back-cover.jpg');
        
        pageImages = images;
        numPages = images.length;
        currentPage = 0;
        
        updateDisplay();
        updateThumbnails();
        updateButtons();
        
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

// Update page display
function updateDisplay() {
    // Reset transforms and shadows
    leftPage.style.transform = '';
    rightPage.style.transform = '';
    leftPage.style.boxShadow = '';
    rightPage.style.boxShadow = '';
    leftPage.style.background = '';
    rightPage.style.background = '';
    
    // Handle front cover (page 0) - show alone, hide right page
    if (currentPage === 0) {
        leftPageImg.src = pageImages[0] || '';
        rightPageImg.src = '';
        leftPageNum.textContent = '1';
        rightPageNum.style.display = 'none';
        rightPage.style.display = 'none';
        leftPage.style.width = 'min(88vw, 840px)';
        pageInfo.textContent = `Front Cover of ${numPages}`;
    }
    // Handle back cover (last page) - show alone, hide left page
    else if (currentPage === numPages - 1) {
        leftPageImg.src = '';
        rightPageImg.src = pageImages[numPages - 1] || '';
        leftPageNum.style.display = 'none';
        rightPageNum.textContent = numPages;
        rightPageNum.style.display = 'block';
        leftPage.style.display = 'none';
        rightPage.style.display = 'block';
        rightPage.style.width = 'min(88vw, 840px)';
        pageInfo.textContent = `Back Cover of ${numPages}`;
    }
    // Show paired pages
    else {
        leftPageImg.src = pageImages[currentPage] || '';
        rightPageImg.src = pageImages[currentPage + 1] || '';
        
        leftPageNum.textContent = currentPage + 1;
        leftPageNum.style.display = 'block';
        rightPageNum.textContent = currentPage + 2;
        rightPageNum.style.display = 'block';
        
        leftPage.style.display = 'block';
        rightPage.style.display = 'block';
        leftPage.style.width = '';
        rightPage.style.width = '';
        
        pageInfo.textContent = `Page ${currentPage + 1}-${currentPage + 2} of ${numPages}`;
    }
    
    updateThumbnails();
}

// Update thumbnails
function updateThumbnails() {
    thumbnails.innerHTML = '';
    pageImages.forEach((img, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail';
        if (idx === currentPage || idx === currentPage + 1) {
            thumb.classList.add('active');
        }
        thumb.dataset.page = idx;
        
        const thumbImg = document.createElement('img');
        thumbImg.src = img;
        thumbImg.alt = `Page ${idx + 1}`;
        
        thumb.appendChild(thumbImg);
        thumb.addEventListener('click', () => {
            flipToPage(parseInt(thumb.dataset.page));
        });
        
        thumbnails.appendChild(thumb);
    });
}

// Update button states
function updateButtons() {
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = currentPage >= numPages - 1;
}

// Complete flip animation from current drag position
function completeFlip(targetPage, startProgress, direction, targetPageNum) {
    isFlipping = true;
    const startTime = performance.now();
    const remainingProgress = 1 - startProgress;
    const duration = remainingProgress * 600; // Scale duration based on remaining distance
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(elapsed / duration, 1);
        const easedProgress = easeInOutCubic(rawProgress);
        
        // Interpolate from startProgress to 1
        const currentProgress = startProgress + (easedProgress * remainingProgress);
        
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
    
    const dragDistance = dragCurrent - dragStart;
    const maxDrag = 150;
    const normalizedDrag = Math.max(-maxDrag, Math.min(maxDrag, dragDistance));
    const progress = Math.min(Math.abs(normalizedDrag) / maxDrag, 1);
    
    // Allow flipping from any page including covers
    if (normalizedDrag < 0 && currentPage < numPages - 1) {
        // Dragging left - flip forward
        const targetPage = currentPage === 0 ? leftPage : rightPage;
        applyPageCurl(targetPage, progress, 1);
        if (currentPage === 0) {
            rightPage.style.transform = '';
            rightPage.style.boxShadow = '';
            rightPage.style.background = '';
        } else {
            leftPage.style.transform = '';
            leftPage.style.boxShadow = '';
            leftPage.style.background = '';
        }
    } else if (normalizedDrag > 0 && currentPage > 0) {
        // Dragging right - flip backward
        const targetPage = currentPage === numPages - 1 ? rightPage : leftPage;
        applyPageCurl(targetPage, progress, -1);
        if (currentPage === numPages - 1) {
            leftPage.style.transform = '';
            leftPage.style.boxShadow = '';
            leftPage.style.background = '';
        } else {
            rightPage.style.transform = '';
            rightPage.style.boxShadow = '';
            rightPage.style.background = '';
        }
    }
}

function handleDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    
    const dragDistance = dragCurrent - dragStart;
    const maxDrag = 150;
    const normalizedDrag = Math.max(-maxDrag, Math.min(maxDrag, dragDistance));
    const progress = Math.min(Math.abs(normalizedDrag) / maxDrag, 1);
    const threshold = 0.5;
    
    if (progress >= threshold) {
        // User dragged past halfway - change page immediately
        if (dragDistance < 0 && currentPage < numPages - 1) {
            currentPage = currentPage + 1;
        } else if (dragDistance > 0 && currentPage > 0) {
            currentPage = currentPage - 1;
        }
        // Update display immediately without animation
        updateDisplay();
        updateButtons();
        isFlipping = false;
    } else {
        // Didn't drag far enough - snap back smoothly
        const targetPage = dragDistance < 0 
            ? (currentPage === 0 ? leftPage : rightPage)
            : (currentPage === numPages - 1 ? rightPage : leftPage);
        const direction = dragDistance < 0 ? 1 : -1;
        animateSnapBack(targetPage, progress, direction);
    }
    
    dragStart = 0;
    dragCurrent = 0;
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

// Add event listeners for drag/swipe
book.addEventListener('mousedown', handleDragStart);
book.addEventListener('mousemove', handleDragMove);
book.addEventListener('mouseup', handleDragEnd);
book.addEventListener('mouseleave', handleDragEnd);

book.addEventListener('touchstart', handleDragStart, { passive: false });
book.addEventListener('touchmove', handleDragMove, { passive: false });
book.addEventListener('touchend', handleDragEnd);

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
updateDisplay();
updateButtons();