import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Play, Settings, Save, Mail, Database, Globe } from 'lucide-react';

interface TutorialProps {
  isOpen: boolean;
  onClose: () => void;
}

const tutorialSteps = [
  {
    title: "¡Bienvenido a FlowMaster!",
    content: "Te guiaré paso a paso para crear tu primer flujo de trabajo automatizado.",
    icon: <Play className="w-8 h-8 text-blue-500" />
  },
  {
    title: "1. Configurar Credenciales",
    content: "Primero ve a 'Configuración' y configura tus credenciales de email (Gmail, Outlook, Yahoo). Esto es OBLIGATORIO para que los nodos funcionen.",
    icon: <Settings className="w-8 h-8 text-green-500" />
  },
  {
    title: "2. Crear un Flujo",
    content: "Ve al 'Constructor de Flujos'. Arrastra nodos desde la paleta lateral al canvas. Cada nodo representa una acción (enviar email, consultar base de datos, etc.).",
    icon: <Database className="w-8 h-8 text-purple-500" />
  },
  {
    title: "3. Configurar Nodos",
    content: "Haz doble clic en cada nodo para configurarlo. Completa TODOS los campos requeridos y prueba la conexión. ¡La configuración se guarda automáticamente!",
    icon: <Mail className="w-8 h-8 text-orange-500" />
  },
  {
    title: "4. Conectar Nodos",
    content: "Haz clic en el punto de salida de un nodo y luego en el punto de entrada de otro para conectarlos. Esto define el orden de ejecución.",
    icon: <Globe className="w-8 h-8 text-indigo-500" />
  },
  {
    title: "5. Guardar y Ejecutar",
    content: "Tu flujo se guarda automáticamente. Usa 'Guardar' para crear una versión permanente y 'Ejecutar' para probarlo. ¡Listo!",
    icon: <Save className="w-8 h-8 text-green-600" />
  }
];

export function Tutorial({ isOpen, onClose }: TutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const nextStep = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const currentTutorial = tutorialSteps[currentStep];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Tutorial FlowMaster</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 text-center">
          <div className="flex justify-center mb-4">
            {currentTutorial.icon}
          </div>
          
          <h3 className="text-xl font-semibold mb-4 text-gray-800">
            {currentTutorial.title}
          </h3>
          
          <p className="text-gray-600 mb-6 leading-relaxed">
            {currentTutorial.content}
          </p>

          <div className="flex justify-center mb-4">
            <div className="flex space-x-2">
              {tutorialSteps.map((_, index) => (
                <div
                  key={index}
                  className={`w-2 h-2 rounded-full ${
                    index === currentStep ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center p-4 border-t bg-gray-50">
          <button
            onClick={prevStep}
            disabled={currentStep === 0}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg ${
              currentStep === 0
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Anterior</span>
          </button>

          <span className="text-sm text-gray-500">
            {currentStep + 1} de {tutorialSteps.length}
          </span>

          {currentStep === tutorialSteps.length - 1 ? (
            <button
              onClick={onClose}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <span>¡Empezar!</span>
            </button>
          ) : (
            <button
              onClick={nextStep}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <span>Siguiente</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}