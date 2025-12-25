import React, { useState, useRef, useEffect } from 'react';
import { Upload, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

const FlipBook = () => {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(2);
  const [currentPage, setCurrentPage] = useState(0);
  const [isFlipping, setIsFlipping] = useState(false);
  const [scale, setScale] = useState(1);
  const [pageImages, setPageImages] = useState(['assets/front-cover.jpg', 'assets/back-cover.jpg']);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [dragCurrent, setDragCurrent] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const bookRef = useRef(null);

  const extractTextAndImages = async (page) => {
    try {
      // Get text content
      const textContent = await page.getTextContent();
      const textItems = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
        fontName: item.fontName
      }));

      // Get page as image without background
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Render page
      await page.render({ 
        canvasContext: context, 
        viewport,
        background: 'transparent'
      }).promise;

      return { textItems, imageData: canvas.toDataURL(), viewport };
    } catch (error) {
      console.error('Error extracting content:', error);
      return null;
    }
  };

  const compositeOnPageTemplate = async (extractedContent) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Load page template
      const templateImg = new Image();
      templateImg.crossOrigin = 'anonymous';
      templateImg.onload = () => {
        canvas.width = templateImg.width;
        canvas.height = templateImg.height;
        
        // Draw page template as background
        ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
        
        // Load and draw extracted content
        const contentImg = new Image();
        contentImg.onload = () => {
          // Calculate scaling to fit content on page template
          const scale = Math.min(
            (canvas.width * 0.85) / contentImg.width,
            (canvas.height * 0.85) / contentImg.height
          );
          
          const scaledWidth = contentImg.width * scale;
          const scaledHeight = contentImg.height * scale;
          const x = (canvas.width - scaledWidth) / 2;
          const y = (canvas.height - scaledHeight) / 2;
          
          // Draw content centered on page
          ctx.drawImage(contentImg, x, y, scaledWidth, scaledHeight);
          
          resolve(canvas.toDataURL());
        };
        contentImg.src = extractedContent.imageData;
      };
      templateImg.src = 'assets/page.jpg';
    });
  };

  const processPDF = async (arrayBuffer) => {
    const typedArray = new Uint8Array(arrayBuffer);
    
    try {
      setIsLoading(true);
      const pdfjsLib = window['pdfjs-dist/build/pdf'];
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      
      const pdf = await pdfjsLib.getDocument(typedArray).promise;
      setPdfDoc(pdf);
      
      const images = [];
      
      // Add front cover
      images.push('assets/front-cover.jpg');
      
      // Process each PDF page
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const extractedContent = await extractTextAndImages(page);
        if (extractedContent) {
          const compositedPage = await compositeOnPageTemplate(extractedContent);
          images.push(compositedPage);
        }
      }
      
      // Add back cover
      images.push('assets/back-cover.jpg');
      
      setPageImages(images);
      setNumPages(images.length);
      setCurrentPage(0);
      setIsLoading(false);
    } catch (error) {
      console.error('Error processing PDF:', error);
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') return;

    const fileReader = new FileReader();
    fileReader.onload = async (event) => {
      await processPDF(event.target.result);
    };
    fileReader.readAsArrayBuffer(file);
  };

  const flipToPage = (pageNum) => {
    if (isFlipping || pageNum < 0 || pageNum >= numPages) return;
    setIsFlipping(true);
    setCurrentPage(pageNum);
    setTimeout(() => setIsFlipping(false), 600);
  };

  const nextPage = () => {
    if (currentPage < numPages - 2) {
      flipToPage(currentPage + 2);
    }
  };

  const prevPage = () => {
    if (currentPage > 0) {
      flipToPage(currentPage - 2);
    }
  };

  const zoomIn = () => setScale(Math.min(scale + 0.2, 2));
  const zoomOut = () => setScale(Math.max(scale - 0.2, 0.6));

  const handleDragStart = (e) => {
    if (isFlipping) return;
    setIsDragging(true);
    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    setDragStart(clientX);
    setDragCurrent(clientX);
  };

  const handleDragMove = (e) => {
    if (!isDragging) return;
    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    setDragCurrent(clientX);
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    
    const dragDistance = dragCurrent - dragStart;
    const threshold = 50;
    
    if (Math.abs(dragDistance) > threshold) {
      if (dragDistance < 0 && currentPage < numPages - 2) {
        flipToPage(currentPage + 2);
      } else if (dragDistance > 0 && currentPage > 0) {
        flipToPage(currentPage - 2);
      }
    }
    
    setDragStart(0);
    setDragCurrent(0);
  };

  const getDragRotation = () => {
    if (!isDragging) return 0;
    const dragDistance = dragCurrent - dragStart;
    const maxRotation = 15;
    const rotation = (dragDistance / 200) * maxRotation;
    return Math.max(-maxRotation, Math.min(maxRotation, rotation));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex flex-col items-center justify-center p-8">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-amber-900 mb-4">3D Flip Book</h1>
        
        <label className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg cursor-pointer hover:bg-amber-700 transition-colors">
          <Upload size={20} />
          <span>{isLoading ? 'Processing...' : pdfDoc ? 'Upload Different PDF' : 'Upload PDF'}</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileUpload}
            className="hidden"
            disabled={isLoading}
          />
        </label>
      </div>

      <div className="mb-4 flex gap-4 items-center">
        <button
          onClick={prevPage}
          disabled={currentPage === 0 || isLoading}
          className="p-2 bg-amber-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-700"
        >
          <ChevronLeft size={24} />
        </button>
        
        <span className="text-amber-900 font-semibold">
          Page {currentPage + 1}-{Math.min(currentPage + 2, numPages)} of {numPages}
        </span>
        
        <button
          onClick={nextPage}
          disabled={currentPage >= numPages - 2 || isLoading}
          className="p-2 bg-amber-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-700"
        >
          <ChevronRight size={24} />
        </button>

        <div className="flex gap-2 ml-4">
          <button
            onClick={zoomOut}
            className="p-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            disabled={isLoading}
          >
            <ZoomOut size={20} />
          </button>
          <button
            onClick={zoomIn}
            className="p-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            disabled={isLoading}
          >
            <ZoomIn size={20} />
          </button>
        </div>
      </div>

      <div 
        ref={bookRef}
        className="relative cursor-grab active:cursor-grabbing select-none"
        style={{ 
          perspective: '2000px',
          transform: `scale(${scale})`,
          transition: 'transform 0.3s',
          touchAction: 'none'
        }}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        <div className="flex" style={{ transformStyle: 'preserve-3d' }}>
          {/* Left Page */}
          <div
            className="relative bg-white shadow-2xl overflow-hidden"
            style={{
              width: '400px',
              height: '550px',
              transformOrigin: 'right center',
              transform: isDragging 
                ? `rotateY(${Math.min(getDragRotation(), 0)}deg)` 
                : isFlipping 
                ? 'rotateY(-5deg)' 
                : 'rotateY(0deg)',
              transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.645, 0.045, 0.355, 1)',
            }}
          >
            {pageImages[currentPage] && (
              <img
                src={pageImages[currentPage]}
                alt={`Page ${currentPage + 1}`}
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute bottom-4 right-4 text-amber-900 text-sm font-semibold bg-white/70 px-2 py-1 rounded">
              {currentPage + 1}
            </div>
          </div>

          {/* Right Page */}
          <div
            className="relative bg-white shadow-2xl overflow-hidden"
            style={{
              width: '400px',
              height: '550px',
              transformOrigin: 'left center',
              transform: isDragging 
                ? `rotateY(${Math.max(getDragRotation(), 0)}deg)` 
                : isFlipping 
                ? 'rotateY(5deg)' 
                : 'rotateY(0deg)',
              transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.645, 0.045, 0.355, 1)',
            }}
          >
            {pageImages[currentPage + 1] && (
              <img
                src={pageImages[currentPage + 1]}
                alt={`Page ${currentPage + 2}`}
                className="w-full h-full object-cover"
              />
            )}
            {currentPage + 1 < numPages && (
              <div className="absolute bottom-4 left-4 text-amber-900 text-sm font-semibold bg-white/70 px-2 py-1 rounded">
                {currentPage + 2}
              </div>
            )}
          </div>
        </div>

        {/* Book Spine Shadow */}
        <div
          className="absolute top-0 bottom-0 w-2 bg-gradient-to-r from-gray-800/30 to-transparent"
          style={{
            left: '400px',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Page Thumbnails */}
      <div className="mt-8 flex gap-2 overflow-x-auto max-w-4xl p-4">
        {pageImages.map((img, idx) => (
          <div
            key={idx}
            onClick={() => flipToPage(idx % 2 === 0 ? idx : idx - 1)}
            className={`flex-shrink-0 cursor-pointer border-2 transition-all ${
              idx === currentPage || idx === currentPage + 1
                ? 'border-amber-600 scale-110'
                : 'border-amber-300 hover:border-amber-500'
            }`}
          >
            <img
              src={img}
              alt={`Thumbnail ${idx + 1}`}
              className="w-16 h-20 object-cover"
            />
          </div>
        ))}
      </div>

      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    </div>
  );
};

export default FlipBook;