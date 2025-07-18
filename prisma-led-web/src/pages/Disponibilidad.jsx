import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import { useAppData } from '../hooks/useAppData';
import CilindroBox from '../components/CilindroBox';
import CilindroModal from '../components/CilindroModal';
import BusquedaInline from '../components/BusquedaInline';
import api from '../services/api';
import VideoLoader from '../components/VideoLoader';
import { usePrereserva } from '../contexts/PrereservaContext';
import Swal from 'sweetalert2'



const esDiciembre = (fecha) => new Date(fecha).getMonth() === 11;

export default function Disponibilidad() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tarifas: tarifasContext, categorias } = useAppData();
  const [loading, setLoading] = useState(false);
  const { prereserva, setPrereserva } = usePrereserva();

  const [isEditando, setisEditando] = useState(prereserva?.edicion?.isEditando || false );
  const [fechaInicio, setFechaInicio] = useState(location.state?.fecha_inicio || prereserva?.edicion?.fecha_inicio || '');
  const [duracion, setDuracion] = useState(parseInt(location.state?.duracion) || parseInt(prereserva?.edicion?.duracion) || 1);
  const [categoria, setCategoria] = useState(location.state?.categoria || prereserva?.edicion?.categoria ||(categorias[0]?.nombre || ''));
  const [data, setData] = useState(null);
  const [seleccionadas, setSeleccionadas] = useState([]);
  const [duraciones, setDuraciones] = useState({});
  const [cilindroSeleccionado, setCilindroSeleccionado] = useState(null);
  const [tooltipInfo, setTooltipInfo] = useState(null);

  const tarifas = tarifasContext.reduce((acc, t) => {
    acc[t.duracion_seg] = t.precio_semana;
    return acc;
  }, {});
  const get_code = tarifasContext.reduce((acc, t) => {
    acc[t.duracion_seg] = t.codigo_tarifa;
    return acc;
  }, {});

  useEffect(() => {
    if (data === null) return;
    if (Object.keys(data).length === 0) navigate('/cliente');
  }, [data, navigate]);

  useEffect(() => {
  const fetchDisponibilidad = async () => {
    setLoading(true);
    try {
      const res = await api.post('/reservas/disponibilidad', {
        fecha_inicio: fechaInicio,
        duracion_semanas: duracion,
        categoria
      });
      setData(res.data);

      // Determinar pantallas iniciales
      const pantallasIniciales =
        location.state?.seleccionadas?.length > 0
          ? location.state?.seleccionadas
          : (prereserva?.edicion?.pantallas || []);

      const disponibles = Object.keys(res.data);

      const solicitadas = pantallasIniciales.map(p => p.id_pantalla);

      const seleccionFiltrada = solicitadas.filter(id => disponibles.includes(id));

      const noDisponibles = solicitadas.filter(id => !disponibles.includes(id));
      if (noDisponibles.length > 0) {
        const nombres = noDisponibles.map(id => {
          const pantalla = res.data[id];
          return pantalla
            ? `Cilindro ${pantalla.cilindro}${pantalla.identificador}`
            : id;
        });
        
        await Swal.fire({
          title: 'Pantallas no disponibles',
          html: `⚠️ Las siguientes pantallas no están disponibles:<br><br><strong>${nombres.join('<br>')}</strong>`,
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });


      }

      setSeleccionadas(seleccionFiltrada);

      const nuevasDuraciones = {};
      pantallasIniciales.forEach(p => {
        if (seleccionFiltrada.includes(p.id_pantalla)) {
          nuevasDuraciones[p.id_pantalla] = p.segundos;
        }
      });
      setDuraciones(nuevasDuraciones);

    } catch (error) {
      console.error('Error al consultar disponibilidad al montar:', error);
      navigate('/cliente');
    } finally {
      setLoading(false);
    }
  };

  if (fechaInicio && duracion && categoria) {
    fetchDisponibilidad();
  }
}, []);


  const calcularFechaFin = () => {
    if (!fechaInicio || !duracion) return '';
    const inicio = new Date(fechaInicio);
    inicio.setDate(inicio.getDate() + parseInt(duracion) * 7);
    return inicio.toISOString().split('T')[0];
  };

  const agrupadasPorCilindro = useMemo(() => {
    if (!data) return {};
    const porCilindro = {};
    Object.entries(data).forEach(([id, pantalla]) => {
      const cil = parseInt(pantalla.cilindro);
      if (!porCilindro[cil]) porCilindro[cil] = [];
      porCilindro[cil].push({ id, data: pantalla });
    });
    Object.values(porCilindro).forEach(arr => {
      arr.sort((a, b) => a.data.identificador.localeCompare(b.data.identificador));
    });
    return porCilindro;
  }, [data]);

  const toggleSeleccion = (pantallaId) => {
    setSeleccionadas((prev) =>
      prev.includes(pantallaId) ? prev.filter((id) => id !== pantallaId) : [...prev, pantallaId]
    );
  };

  const handleDuracionChange = (pantallaId, segundos) => {
    setDuraciones((prev) => ({ ...prev, [pantallaId]: segundos }));
  };

  const calcularPrecio = (pantallaId) => {
    const segundos = duraciones[pantallaId];
    if (!segundos || !tarifas[segundos]) return 0;
    const base = esDiciembre(fechaInicio) ? 2000000 : tarifas[segundos];
    let total = base * duracion;
    let descuento = 0;
    if (!esDiciembre(fechaInicio)) {
      if (duracion > 26) descuento = 0.1;
      else if (duracion > 13) descuento = 0.034;
    }
    total *= 1 - descuento;
    return { total, base, descuento };
  };

  const subtotal = seleccionadas.reduce((acc, id) => {
    const precio = calcularPrecio(id);
    return acc + (precio?.total || 0);
  }, 0);

  const ahorroTotal = (() => {
    let ahorro = 0;
    seleccionadas.forEach(id => {
      const segundos = duraciones[id];
      if (!segundos || !tarifas[segundos]) return
      const base = esDiciembre(fechaInicio) ? 2000000 : tarifas[segundos];
      const totalSinDescuento = base * duracion;
      const precio = calcularPrecio(id);
      const totalConDescuento = precio ? precio.total : 0;
      ahorro += totalSinDescuento - totalConDescuento;
    });
    return ahorro;
  })();

  const handleTooltip = (pantalla) => {
    if ((pantalla.estado === 'parcial' || pantalla.estado === 'ocupado' || pantalla.estado === 'reservado') && pantalla.mensaje) {
      setTooltipInfo({ id: pantalla.id, mensaje: pantalla.mensaje });
      setTimeout(() => setTooltipInfo(null), 5000);
    }
  };

  const puedeConfirmar = seleccionadas.length > 0 && seleccionadas.every(id => duraciones[id]);

  if (loading) {
    return <VideoLoader />;
  }
  return (
    <div className="bg-gray-50 p-4 md:p-6 flex flex-col min-h-full">
      <h2 className="text-2xl font-bold text-center mb-2">Mapa de disponibilidad</h2>
      <BusquedaInline
        fechaInicio={fechaInicio}
        duracion={duracion}
        categoria={categoria}
        onChange={({ fechaInicio, duracion, categoria }) => {
          setFechaInicio(fechaInicio);
          setDuracion(duracion);
          setCategoria(categoria);
        }}
        onBuscar={async (fecha, semanas, cat) => {
          setLoading(true); // 👉 inicia loader
          try {
            const res = await api.post('/reservas/disponibilidad', {
              fecha_inicio: fecha,
              duracion_semanas: semanas,
              categoria: cat
            });
            setSeleccionadas([]);
            setDuraciones({});
            setTooltipInfo(null);
            setData(res.data);
          } catch (error) {
            await Swal.fire({
            title: 'Error al consultar',
            text: 'No se pudo obtener disponibilidad. Intenta de nuevo.',
            icon: 'error',
            confirmButtonText: 'Ok'
          });
            console.error(error);
          }finally {
            setLoading(false); // 👉 termina loader
          }
        }}
      />

      {cilindroSeleccionado && (
        <CilindroModal
          cilindro={cilindroSeleccionado}
          onClose={() => setCilindroSeleccionado(null)}
        />
      )}

      <div className="flex flex-col lg:flex-row gap-6 w-full overflow-hidden">  
        <div className="flex-1 border rounded p-4 bg-white shadow">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-6 justify-items-center w-full">
            {Object.entries(agrupadasPorCilindro)
              .sort(([a], [b]) => a - b)
              .map(([cilindro, pantallas]) => (
                <CilindroBox
                  key={cilindro}
                  cilindro={cilindro}
                  pantallas={pantallas}
                  seleccionadas={seleccionadas}
                  onToggleSeleccion={toggleSeleccion}
                  onMostrarImagen={setCilindroSeleccionado}
                  onTooltip={handleTooltip}
                />
              ))}
          </div>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-black rounded" /> Seleccionada</div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-300 rounded" /> Ocupado</div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-300 rounded" /> Reservado</div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-green-200 rounded" /> Disponible</div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-yellow-300 rounded" /> Parcialmente ocupada</div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-red-500 rounded" /> Restringido</div>
          </div>
          {tooltipInfo && (
            <div className="fixed bottom-4 right-4 bg-black text-white text-xs px-4 py-2 rounded shadow z-50 whitespace-pre-line">
              {tooltipInfo.mensaje}
              <button onClick={() => setTooltipInfo(null)} className="ml-4 text-red-300">✖</button>
            </div>
          )}
        </div>

        <div className="w-full lg:w-80 border rounded p-4 bg-white shadow flex flex-col max-h-[85vh]">
          <div className="overflow-y-auto pr-2 flex-1">
            <p className="text-lg font-bold mb-2 text-violet-700">Resumen selección</p>
            <p className="text-lg mb-2 text-violet-700">Fechas pauta </p>
            <p className="text-lg mb-2">Fecha inicio:  {fechaInicio || '---'}  </p>
            <p className="text-lg mb-2">Fechas fin:  {calcularFechaFin() || '---'} </p>
            <p className="text-lg mb-2 text-violet-700">Categoría: {categoria || '---'} </p>
            <p className="text-lg font-bold mb-2 text-violet-700"> - - - - - - </p>
            {seleccionadas.length === 0 ? (
              <p className="text-sm text-gray-500">No has seleccionado pantallas aún.</p>
            ) : (
              <ul className="text-sm space-y-3 mb-4">
                {seleccionadas.map((id) => {
                  const info = data[id];
                  const segundosDisp = info.segundos_disponibles;
                  const opciones = [20, 40, 60].filter(op => op <= segundosDisp);
                  return (
                    <li key={id} className="flex flex-col">
                      <div className="flex justify-between items-center">
                        <span>Cilindro {info.cilindro}{info.identificador}</span>
                        <button className="text-red-600 text-sm ml-2" onClick={() => toggleSeleccion(id)}>❌</button>
                      </div>
                      <select
                        value={duraciones[id] || ''}
                        onChange={(e) => handleDuracionChange(id, parseInt(e.target.value))}
                        className="mt-1 border rounded px-2 py-1"
                      >
                        <option value="">Duración (s)</option>
                        {opciones.map((seg) => (
                          <option key={seg} value={seg}>{seg} segundos</option>
                        ))}
                      </select>
                      <span className="text-right text-xs mt-1 text-gray-500">
                        Precio: {(() => {
                          const precio = calcularPrecio(id);
                          return precio ? `$${precio.total.toLocaleString('es-CO')}` : '-';
                        })()} 
                        ( ${(() => {
                          const segundos = duraciones[id];
                          if (!segundos || !tarifas[segundos]) return 0;
                          return esDiciembre(fechaInicio) ? 2000000 : tarifas[segundos];
                        })().toLocaleString('es-CO')} x semana )
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="text-sm font-semibold text-right pt-2 border-t mt-2">
            {seleccionadas.map((id) => {
              const result = calcularPrecio(id);
              const descuento = result ? result.descuento : 0;
              return (
                descuento > 0 && (
                  <div key={id} className="text-xs text-red-600 text-right">
                    Descuento aplicado: -{(descuento * 100).toFixed(1)}%
                  </div>
                )
              );
            })}
            Subtotal: <span className="text-violet-700">${subtotal.toLocaleString('es-CO')}</span>
            {ahorroTotal > 0 && (
              <div className="text-xs text-red-500 mt-1">
                Ahorro total: ${ahorroTotal.toLocaleString('es-CO')}
              </div>
            )}
          </div>
          
          
      <button
        disabled={!puedeConfirmar}
        className="w-full bg-violet-600 text-white py-2 mt-2 rounded disabled:bg-gray-300"
       
        onClick={() => {
          const payload = seleccionadas.map(id => {
            const segundos = duraciones[id];
            const precio = calcularPrecio(id);
            const cod_tarifas = get_code[segundos];
            return {
              id_pantalla: id,
              cilindro: data[id].cilindro,
              identificador: data[id].identificador,
              segundos,
              cod_tarifas,
              precio: precio?.total || 0,
              base: precio?.base || 0,
              descuento: precio?.descuento || 0
            };
          });
          if (isEditando) {
              setPrereserva({
                ...prereserva,
                edicion: {
                  ...prereserva.edicion,
                  fecha_inicio: fechaInicio,
                  duracion,
                  categoria,
                  pantallas: payload
                }
              });
              navigate('/cliente/pre-orden')
            }else{
              navigate('/cliente/pre-orden', {
                state: {
                  fecha_inicio: fechaInicio,
                  duracion,
                  categoria,
                  pantallas: payload,
                  disponibilidad: data
                }
              });
          }
        }}


      >
        Confirmar selección
      </button>
      <button
        onClick={() => navigate('/cliente/reserva')}
        className="w-full bg-black text-white py-2 mt-2 rounded disabled:bg-gray-300"
      >
        Cancelar selección
      </button>
        </div>
      </div>
    </div>
  );
}
