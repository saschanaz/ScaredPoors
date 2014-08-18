/*
TODO:
Change the text below the title as phase changes
1. Load file
2. Select target area
3. Set the threshold value from user-measured reference length and subject volume
*/

class MemoryBox {
    canvas = document.createElement("canvas");
    canvasContext: CanvasRenderingContext2D;
    constructor() {
        this.canvasContext = this.canvas.getContext("2d");
    }
}

var videoPresenter: HTMLElement = null;
var videoControl: VideoPlayable = null;

var analyzer = new ScaredPoors();
var lastImageFrame: FrameData;
var memoryBox = new MemoryBox();
//var occurrences: Occurrence[] = [];
interface Area {
    x: number;
    y: number;
    width: number;
    height: number;
}
interface FrameData {
    time: number;
    imageData: ImageData;
}
interface Occurrence {
    isOccured: boolean;
    watched: number;
    judged: number;
}
interface Continuity {
    start: number;
    end: number;
}
interface Equality {
    type: string;
    isEqual: boolean;
    time: number;
}

if (!window.setImmediate) {
    window.setImmediate = (expression: any, ...args: any[]) => window.setTimeout.apply(window, [expression, 0].concat(args));
}

var imageDiffWorker = new Worker("imagediffworker.js");

var loadVideo = (file: Blob) => {
    panel.onclick = null;

    if (videoControl) {
        videoControl.pause();
        if (videoControl !== <any>videoPresenter) {
            videoControl.src = "";
            document.removeChild((<any>videoPresenter).player);
            videoPresenter = null;
        }
    }

    if (!videoNativeElement.canPlayType(file.type)) {
        switch (file.type) {
            case "video/avi":
                var player = new MJPEGPlayer();
                presenter.appendChild(player.element);
                videoControl = player;
                videoPresenter = player.element;
                break;
        }
    }
    else {
        videoPresenter = videoControl = videoNativeElement;
        videoNativeElement.style.display = "";
    }
    
    videoControl.src = URL.createObjectURL(file);

    return VideoElementExtensions.waitMetadata(videoControl).then(() => {
        openOptions.style.display = areaText.style.display = "";
        videoSlider.max = videoControl.duration.toString();
        phaseText.innerHTML =
        "Drag the screen to specify the analysis target area.\
        Then, click the bottom bar to proceed.\
        Open the options pages to adjust parameters.".replace(/\s\s+/g, "<br />");

        var dragPresenter = new DragPresenter(panel, videoPresenter, "targetArea");
        var scaleToOriginal = (area: Area) => {
            var scaleX = videoControl.videoWidth / videoPresenter.clientWidth;
            var scaleY = videoControl.videoHeight / videoPresenter.clientHeight;
            return {
                x: Math.round(area.x * scaleX),
                y: Math.round(area.y * scaleY),
                width: Math.round(area.width * scaleX),
                height: Math.round(area.height * scaleY)
            };
        };

        dragPresenter.ondragsizechanged = (area) => {
            area = scaleToOriginal(area);
            areaXText.textContent = area.x.toFixed();
            areaYText.textContent = area.y.toFixed();
            areaWidthText.textContent = area.width.toFixed();
            areaHeightText.textContent = area.height.toFixed();
        };

        statusPresenter.onclick = () => {
            if (dragPresenter.isDragged) {
                phaseText.style.display = openOptions.style.display = areaText.style.display = "none";
                analysisText.style.display = "";
                dragPresenter.close();
                startAnalyze(scaleToOriginal(dragPresenter.getTargetArea()));
            }
        };
    });
};

var startAnalyze = (crop: Area) => {
    //crop = {
    //    x: 139,
    //    y: 236,
    //    width: 309,
    //    height: 133
    //}
    memoryBox.canvas.width = crop.width;
    memoryBox.canvas.height = crop.height;
    var manager = new FreezingManager();
    //var threshold = 100;
    var threshold = Math.round(crop.width * crop.height * 2.43e-3);

    var sequence = getFrameImageData(0, videoControl.videoWidth, videoControl.videoHeight, crop)
        .then((imageData) => {
            lastImageFrame = { time: videoControl.currentTime, imageData: imageData };
        });

    for (var time = 0.1; time <= videoControl.duration; time += 0.1) {
        ((time: number) => {
            var imageData: ImageData;
            sequence = sequence
                .then(() => getFrameImageData(time, videoControl.videoWidth, videoControl.videoHeight, crop))
                .then((_imageData) => {
                    imageData = _imageData;
                    return equal(videoControl.currentTime, imageData, threshold);
                }).then((equality) => {
                    manager.loadOccurrence({ watched: lastImageFrame.time, judged: equality.time, isOccured: equality.isEqual });
                    lastImageFrame = { time: videoControl.currentTime, imageData: imageData };
                });
        })(time);
    }

    return sequence
        .then(() => {
             frozenRatioText.textContent = manager.frozenRatio.toFixed(2);
        });
};

var getFrameImageData = (time: number, originalWidth: number, originalHeight: number, crop: Area) => {
    return VideoElementExtensions.seekFor(videoControl, time)
        .then(() => new Promise<ImageData>((resolve, reject) => {
            if (videoControl === <any>videoPresenter) {
                memoryBox.canvasContext.drawImage(videoPresenter,
                    crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
                resolve(memoryBox.canvasContext.getImageData(0, 0, crop.width, crop.height));
            }
            else {
                exportImageDataFromImage(<HTMLImageElement>videoPresenter, originalWidth, originalHeight, crop)
                    .then((imageData) => resolve(imageData));
                //draw image, as getImageData does.
            }
        }));
}

var exportImageDataFromImage = (img: HTMLImageElement, width: number, height: number, crop: Area) => {
    return ImageElementExtensions.waitCompletion(img)
        .then(() => {
            if (img.naturalWidth !== width
                || img.naturalHeight !== height)
                console.warn(["Different image size is detected.", img.naturalWidth, width, img.naturalHeight, height].join(" "));
            memoryBox.canvasContext.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
            return memoryBox.canvasContext.getImageData(0, 0, crop.width, crop.height);
        });
};

var equal = (time: number, imageData: ImageData, pixelTolerance: number) => {
    return new Promise<Equality>((resolve, reject) => {
        var callback = (e: MessageEvent) => {
            imageDiffWorker.removeEventListener("message", callback);
            if (e.data.type == "equality")
                resolve(e.data);
        };
        imageDiffWorker.addEventListener("message", callback);
        imageDiffWorker.postMessage({
            type: "equal", time: time,
            data1: lastImageFrame.imageData, data2: imageData, colorTolerance: 60, pixelTolerance: pixelTolerance
        });
    });
};