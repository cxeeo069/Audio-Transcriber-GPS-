import React, { useState, useRef, useEffect } from 'react';
import { Upload, Link as LinkIcon, Play, Pause, Search, FileAudio, RefreshCw, Download, Loader2, FileText } from 'lucide-react';
import { convertAudio } from './utils/ffmpeg';
import { GoogleGenAI } from '@google/genai';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type TranscriptionChunk = {
  time: string;
  text: string;
};

export default function App() {
  const [audioFile, setAudioFile] = useState<File | Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [inputUrl, setInputUrl] = useState<string>('');
  
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [transcription, setTranscription] = useState<TranscriptionChunk[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [targetFormat, setTargetFormat] = useState<'mp3' | 'm4a' | 'aac'>('mp3');

  const audioRef = useRef<HTMLAudioElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
      setAudioUrl(URL.createObjectURL(file));
      setTranscription([]);
      setConvertedUrl(null);
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl) return;
    
    try {
      // Use proxy to bypass CORS
      const response = await fetch(`/api/proxy-audio?url=${encodeURIComponent(inputUrl)}`);
      if (!response.ok) throw new Error('Failed to fetch audio');
      
      const blob = await response.blob();
      setAudioFile(blob);
      setAudioUrl(URL.createObjectURL(blob));
      setTranscription([]);
      setConvertedUrl(null);
    } catch (error) {
      console.error(error);
      alert('Failed to load audio from URL. Please check the URL and try again.');
    }
  };

  const handleTranscribe = async () => {
    if (!audioFile) return;
    
    setIsTranscribing(true);
    setTranscriptionProgress(0);
    
    // Simulate progress while waiting for API
    const progressInterval = setInterval(() => {
      setTranscriptionProgress(prev => {
        // Slow down progress as it gets closer to 90%
        if (prev >= 90) return prev;
        const increment = Math.max(0.5, (90 - prev) / 20);
        return prev + increment;
      });
    }, 1000);

    try {
      const prompt = `Please provide a complete, verbatim transcription of the entire audio file. You must transcribe every single word without any omissions, summaries, or abbreviations. Include accurate timestamps for every sentence or phrase in the exact format [MM:SS] or [HH:MM:SS]. Ensure the timestamps precisely match the audio playback time. Do not include any other text besides the timestamps and the transcription.`;
      
      const reader = new FileReader();
      reader.readAsDataURL(audioFile);
      
      const response = await new Promise<any>((resolve, reject) => {
        reader.onloadend = async () => {
          try {
            const base64data = reader.result as string;
            const base64String = base64data.split(',')[1];
            const mimeType = audioFile.type || 'audio/mp3';

            const res = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: base64String,
                    },
                  },
                  { text: prompt },
                ],
              },
            });
            resolve(res);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
      });

      if (!response) throw new Error('Failed to get response from Gemini');

      const text = response.text || '';
      
      // Parse the text into chunks
      const lines = text.split('\n');
      const chunks: TranscriptionChunk[] = [];
      
      const timeRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/;
      
      for (const line of lines) {
        const match = line.match(timeRegex);
        if (match) {
          chunks.push({
            time: match[1],
            text: match[2],
          });
        } else if (line.trim()) {
          // If no timestamp but has text, append to last chunk or add new
          if (chunks.length > 0) {
            chunks[chunks.length - 1].text += ' ' + line.trim();
          } else {
            chunks.push({ time: '00:00', text: line.trim() });
          }
        }
      }
      
      setTranscription(chunks);
      setTranscriptionProgress(100);
      clearInterval(progressInterval);
      setTimeout(() => setIsTranscribing(false), 500);
    } catch (error) {
      console.error(error);
      alert('Transcription failed. The file might be too large or the API encountered an error.');
      clearInterval(progressInterval);
      setIsTranscribing(false);
    }
  };

  const handleConvert = async () => {
    if (!audioFile) return;
    
    setIsConverting(true);
    setConversionProgress(0);
    
    try {
      const convertedBlob = await convertAudio(audioFile, targetFormat, (progress) => {
        setConversionProgress(progress);
      });
      
      const url = URL.createObjectURL(convertedBlob);
      setConvertedUrl(url);
    } catch (error) {
      console.error(error);
      alert('Conversion failed. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };

  const handleExportWord = async () => {
    if (transcription.length === 0) return;

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: transcription.map((chunk) => {
            return new Paragraph({
              children: [
                new TextRun({
                  text: `[${chunk.time}] `,
                  bold: true,
                  color: "059669", // emerald-600
                }),
                new TextRun({
                  text: chunk.text,
                }),
              ],
              spacing: {
                after: 200,
              },
            });
          }),
        },
      ],
    });

    try {
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'transcription.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export Word document:', error);
      alert('Failed to export Word document.');
    }
  };

  const filteredTranscription = transcription.filter(chunk => 
    chunk.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Audio Transcriber</h1>
          <p className="text-neutral-500">Upload an audio file or enter a URL to transcribe and convert.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Left Column: Input & Controls */}
          <div className="space-y-6">
            
            {/* Upload Section */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60 space-y-6">
              <div className="space-y-4">
                <h2 className="text-lg font-medium">1. Select Audio</h2>
                
                <div className="flex items-center justify-center w-full">
                  <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-32 border-2 border-neutral-300 border-dashed rounded-xl cursor-pointer bg-neutral-50 hover:bg-neutral-100 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-8 h-8 mb-3 text-neutral-400" />
                      <p className="mb-2 text-sm text-neutral-500"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                      <p className="text-xs text-neutral-400">MP3, M4A, AAC (Max 3 hours)</p>
                    </div>
                    <input id="dropzone-file" type="file" className="hidden" accept=".mp3,.m4a,.aac,audio/*" onChange={handleFileUpload} />
                  </label>
                </div>

                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-neutral-200"></div>
                  <span className="flex-shrink-0 mx-4 text-neutral-400 text-sm">OR</span>
                  <div className="flex-grow border-t border-neutral-200"></div>
                </div>

                <form onSubmit={handleUrlSubmit} className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                      <LinkIcon className="w-4 h-4 text-neutral-400" />
                    </div>
                    <input 
                      type="url" 
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      className="bg-neutral-50 border border-neutral-300 text-neutral-900 text-sm rounded-lg focus:ring-neutral-500 focus:border-neutral-500 block w-full pl-10 p-2.5" 
                      placeholder="Paste audio URL here..." 
                    />
                  </div>
                  <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors">
                    Load
                  </button>
                </form>
              </div>
            </div>

            {/* Audio Player & Actions */}
            {audioUrl && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60 space-y-6">
                <div className="space-y-4">
                  <h2 className="text-lg font-medium flex items-center gap-2">
                    <FileAudio className="w-5 h-5 text-neutral-500" />
                    Audio Loaded
                  </h2>
                  
                  <audio ref={audioRef} src={audioUrl} controls className="w-full" />

                  <div className="pt-4 border-t border-neutral-100 space-y-4">
                    <button 
                      onClick={handleTranscribe}
                      disabled={isTranscribing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isTranscribing ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Transcribing...</>
                      ) : (
                        <><FileAudio className="w-4 h-4" /> Transcribe to Text</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Format Conversion */}
            {audioUrl && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60 space-y-4">
                <h2 className="text-lg font-medium">Format Conversion</h2>
                <div className="flex items-center gap-4">
                  <select 
                    value={targetFormat}
                    onChange={(e) => setTargetFormat(e.target.value as any)}
                    className="bg-neutral-50 border border-neutral-300 text-neutral-900 text-sm rounded-lg focus:ring-neutral-500 focus:border-neutral-500 block p-2.5"
                  >
                    <option value="mp3">MP3</option>
                    <option value="m4a">M4A</option>
                    <option value="aac">AAC</option>
                  </select>
                  
                  <button 
                    onClick={handleConvert}
                    disabled={isConverting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConverting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Converting {Math.round(conversionProgress)}%</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> Convert</>
                    )}
                  </button>
                </div>

                {convertedUrl && (
                  <div className="pt-4 flex items-center justify-between bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                    <span className="text-sm text-emerald-800 font-medium">Ready: output.{targetFormat}</span>
                    <a 
                      href={convertedUrl} 
                      download={`converted.${targetFormat}`}
                      className="flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800"
                    >
                      <Download className="w-4 h-4" /> Download
                    </a>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Right Column: Transcription */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60 flex flex-col h-[800px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-medium">Transcription</h2>
              
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <Search className="w-4 h-4 text-neutral-400" />
                  </div>
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-neutral-50 border border-neutral-300 text-neutral-900 text-sm rounded-lg focus:ring-neutral-500 focus:border-neutral-500 block w-48 pl-10 p-2" 
                    placeholder="Search text..." 
                  />
                </div>
                
                {transcription.length > 0 && (
                  <button
                    onClick={handleExportWord}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors border border-emerald-200"
                    title="Export to Word"
                  >
                    <FileText className="w-4 h-4" />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-4">
              {isTranscribing ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-400 space-y-4">
                  <div className="flex flex-col items-center space-y-4 w-full max-w-xs">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <div className="text-center space-y-1">
                      <p className="text-neutral-600 font-medium">Analyzing audio...</p>
                      <p className="text-xs text-neutral-400">This may take a minute for longer files.</p>
                    </div>
                    <div className="w-full bg-neutral-100 rounded-full h-2 overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300 ease-out" 
                        style={{ width: `${Math.min(100, Math.max(0, transcriptionProgress))}%` }}
                      />
                    </div>
                    <p className="text-xs font-mono text-emerald-600">{Math.round(transcriptionProgress)}%</p>
                  </div>
                </div>
              ) : transcription.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-400 space-y-4">
                  <FileAudio className="w-12 h-12 opacity-20" />
                  <div className="text-center space-y-1">
                    <p className="text-neutral-600 font-medium">No transcription yet</p>
                    <p className="text-sm">Upload an audio file and click Transcribe.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredTranscription.map((chunk, idx) => (
                    <div key={idx} className="flex gap-4 p-3 hover:bg-neutral-50 rounded-lg transition-colors group">
                      <button 
                        onClick={() => {
                          if (audioRef.current) {
                            const parts = chunk.time.split(':').map(Number);
                            let timeInSeconds = 0;
                            if (parts.length === 3) {
                              timeInSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                            } else if (parts.length === 2) {
                              timeInSeconds = parts[0] * 60 + parts[1];
                            }
                            audioRef.current.currentTime = timeInSeconds;
                            audioRef.current.play();
                          }
                        }}
                        className="flex-shrink-0 text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-1 rounded h-fit mt-0.5 group-hover:bg-emerald-100 transition-colors cursor-pointer"
                      >
                        {chunk.time}
                      </button>
                      <p className="text-sm text-neutral-700 leading-relaxed">
                        {chunk.text}
                      </p>
                    </div>
                  ))}
                  {filteredTranscription.length === 0 && searchQuery && (
                    <div className="text-center text-neutral-500 py-8">
                      No results found for "{searchQuery}"
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
